import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { parse } from 'yaml';
import { POLICY } from '../src/app.module';

/**
 * The rules in architecture/boundaries.md, machine-enforced (Governed App
 * Starter §26).
 *
 * These used to be prose plus review. Prose does not fail a build, and an
 * agent that has not read boundaries.md will not be stopped by it. Every
 * assertion below has a paragraph in architecture/ or a decisions/ ADR behind
 * it; when one of them is wrong, change the document and this file together,
 * never just this file.
 *
 * Deliberately no architecture-testing framework: a directory walk and the
 * import lines are enough, and a starter should not make a customer adopt a
 * tool to understand its own rules. It lives in the API's test runner because
 * that is the only plain Node runner in the repo, but it is a REPOSITORY test
 * — it reads client/ and onklave.yaml too.
 */

const REPO = resolve(__dirname, '..', '..');
const SERVER_SRC = join(REPO, 'server', 'src');
const CLIENT_SRC = join(REPO, 'client', 'src');

interface SourceFile {
  /** Repo-relative, POSIX-ish, e.g. `server/src/items/items.controller.ts`. */
  path: string;
  /** The file with comments removed. Every rule below reads THIS, never the
   *  raw text: this repo documents its rules in the code that follows them, so
   *  a comment saying "never call enableCors()" would otherwise fail the rule
   *  it exists to explain. */
  code: string;
  /** Every module specifier this file imports, with whether it is type-only. */
  imports: Array<{ from: string; typeOnly: boolean }>;
}

/** Block comments, then line comments — the `[^:]` guard spares `https://`. */
const stripComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** Every .ts file under a directory, excluding .d.ts. */
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return walk(full);
    }
    return full.endsWith('.ts') && !full.endsWith('.d.ts') ? [full] : [];
  });
}

/**
 * `import … from 'x'`, `export … from 'x'`, `require('x')` and `import('x')`.
 * Regex rather than a TypeScript AST on purpose: the rules are about which
 * module a file names, and a name is all that is needed to check them.
 */
const IMPORT_PATTERN = /(?:^|\n)\s*(?:import|export)(\s+type)?\s[^;]*?from\s*['"]([^'"]+)['"]/g;
const CALL_PATTERN = /(?:require|import)\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function read(root: string): SourceFile[] {
  return walk(root).map((full) => {
    const code = stripComments(readFileSync(full, 'utf8'));
    const imports: SourceFile['imports'] = [];
    for (const m of code.matchAll(IMPORT_PATTERN)) {
      imports.push({ from: m[2], typeOnly: Boolean(m[1]) });
    }
    for (const m of code.matchAll(CALL_PATTERN)) {
      imports.push({ from: m[1], typeOnly: false });
    }
    return { path: relative(REPO, full).split(sep).join('/'), code, imports };
  });
}

const serverFiles = read(SERVER_SRC);
const clientFiles = read(CLIENT_SRC);

/** The governance half of onklave.yaml, as the platform would read it. */
interface Manifest {
  capabilities?: string[];
  approvals?: Record<string, string>;
  validation?: string[];
  agent?: { entrypoint?: string };
  services: Array<{ name: string; env?: unknown; build?: { args?: unknown } }>;
}

const manifest = parse(readFileSync(join(REPO, 'onklave.yaml'), 'utf8')) as Manifest;

/** The npm scripts one service defines — what a `validation:` step must name. */
const scriptsOf = (service: string): string[] =>
  Object.keys(
    (JSON.parse(readFileSync(join(REPO, service, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    }).scripts ?? {},
  );

/** Where a relative specifier lands, repo-relative. Bare specifiers stay as-is. */
function resolveImport(file: SourceFile, specifier: string): string {
  if (!specifier.startsWith('.')) {
    return specifier;
  }
  const from = join(REPO, dirname(file.path));
  return relative(REPO, resolve(from, specifier)).split(sep).join('/');
}

/** Assert a rule over a set of files, reporting every violation at once. */
function assertNoneMatch(
  files: SourceFile[],
  rule: (file: SourceFile) => string | undefined,
  message: string,
): void {
  const violations = files.map((f) => rule(f)).filter((v): v is string => Boolean(v));
  assert.deepEqual(violations, [], `${message}\n  ${violations.join('\n  ')}`);
}

describe('the two services never import each other', () => {
  test('neither build can pull code out of the other', () => {
    // They are two images built from two contexts; an import across the line
    // would either fail the build or compile server code into a public bundle.
    for (const [files, own] of [
      [serverFiles, 'server'],
      [clientFiles, 'client'],
    ] as const) {
      assertNoneMatch(
        files,
        (file) => {
          const escaped = file.imports
            .filter((i) => i.from.startsWith('.'))
            .map((i) => resolveImport(file, i.from))
            .filter((p) => !p.startsWith(`${own}/`));
          return escaped.length ? `${file.path} -> ${escaped.join(', ')}` : undefined;
        },
        `a ${own}/ file reached outside its own service:`,
      );
    }
  });
});

describe('nothing secret-bearing can reach the browser', () => {
  test('the client reads no environment at all', () => {
    // The bundle is public, so there is no such thing as a secret build-time
    // value in it. The error-tracking key is fetched at runtime instead —
    // client/src/onklave.ts. AGENTS.md §5.
    assertNoneMatch(
      clientFiles,
      (file) =>
        /process\.env|import\.meta\.env/.test(file.code)
          ? `${file.path} reads build-time configuration`
          : undefined,
      'the client bundle must take no configuration that could be a credential:',
    );
  });

  test('the client imports nothing from the action boundary or an adapter', () => {
    // A policy decision, a provider or a credential reference on the browser
    // side is a decision made where it cannot be trusted.
    assertNoneMatch(
      clientFiles,
      (file) => {
        const bad = file.imports
          .map((i) => i.from)
          .filter((s) => /(^|\/)(actions|providers)\//.test(s) || /\.provider(\.|$)/.test(s));
        return bad.length ? `${file.path} -> ${bad.join(', ')}` : undefined;
      },
      'the client must not import the server-side action boundary:',
    );
  });

  test('the web service declares no environment in the manifest', () => {
    // Anything declared on a browser-facing service ends up public — as do
    // build args, which are readable from image history and get compiled in.
    const web = manifest.services.find((s) => s.name === 'web');
    assert.ok(web, 'the web service must exist in onklave.yaml');
    assert.equal(web.env, undefined, 'env on the web service would be public');
    assert.equal(web.build?.args, undefined, 'build args on the web service would be public');
  });
});

describe('an adapter is a leaf', () => {
  test('providers/ imports only its own siblings and the action vocabulary', () => {
    // If an adapter can see the domain it stops being swappable, and a rule
    // that belongs in the executor starts living in an integration.
    assertNoneMatch(
      serverFiles.filter((f) => f.path.startsWith('server/src/providers/')),
      (file) => {
        const bad = file.imports
          .map((i) => resolveImport(file, i.from))
          .filter(
            (p) =>
              p.startsWith('server/') &&
              !p.startsWith('server/src/providers/') &&
              p !== 'server/src/actions/action.types',
          );
        return bad.length ? `${file.path} -> ${bad.join(', ')}` : undefined;
      },
      'an adapter may import only providers/ and actions/action.types:',
    );
  });
});

describe('a sensitive action can only run through ActionExecutor', () => {
  test('nothing outside the boundary holds a provider as a value', () => {
    // The composition root registers adapters; the executor selects one. Any
    // other file holding one could call it directly and skip policy, approval,
    // the re-check and the audit record. A `import type` is allowed: it is
    // erased at compile time, so it cannot call anything — items.controller.ts
    // borrows the message shape that way.
    const allowed = new Set([
      'server/src/app.module.ts',
      'server/src/actions/action-executor.ts',
    ]);
    assertNoneMatch(
      serverFiles.filter(
        (f) => !allowed.has(f.path) && !f.path.startsWith('server/src/providers/'),
      ),
      (file) => {
        const bad = file.imports
          .filter((i) => !i.typeOnly)
          .map((i) => resolveImport(file, i.from))
          .filter((p) => /provider-registry$|\.provider$/.test(p));
        return bad.length ? `${file.path} -> ${bad.join(', ')}` : undefined;
      },
      'only the composition root and the executor may hold an adapter:',
    );
  });

  test('one pool, in one place', () => {
    // db.ts is the only file that reads DATABASE_URL and the only one that
    // builds a pool, so there is one connection lifecycle to reason about.
    assertNoneMatch(
      serverFiles.filter((f) => f.path !== 'server/src/db.ts'),
      (file) => (/new Pool\s*\(/.test(file.code) ? `${file.path} constructs a Pool` : undefined),
      'only server/src/db.ts may construct a pg Pool:',
    );
  });
});

describe('every governance declaration in onklave.yaml is true', () => {
  test('capabilities: and ACTION_POLICY are the same set', () => {
    // The manifest is what the platform reads; ACTION_POLICY is what the
    // runtime enforces. A capability in one and not the other is either an
    // undeclared power or a declaration the code cannot honour.
    assert.deepEqual(
      [...(manifest.capabilities ?? [])].sort(),
      Object.keys(POLICY).sort(),
      'capabilities: in onklave.yaml must match ACTION_POLICY in app.module.ts',
    );
  });

  test('an approval declared for an in-app capability is required in ACTION_POLICY', () => {
    // Platform operations (deploy.production) have no ACTION_POLICY entry and
    // are not in scope here; an in-app capability listed under approvals: is.
    for (const [operation, mode] of Object.entries(manifest.approvals ?? {})) {
      if (operation in POLICY) {
        assert.equal(POLICY[operation], mode, `approvals: and ACTION_POLICY disagree on ${operation}`);
      }
    }
  });

  test('every declared validation step is a real command', () => {
    // The step that most wants to rot: a name here with no script behind it is
    // a validation the platform believes it is running and nobody is.
    const scripts = new Set([...scriptsOf('server'), ...scriptsOf('client')]);
    for (const step of manifest.validation ?? []) {
      assert.ok(scripts.has(step), `validation: declares '${step}' but no service has that script`);
    }
  });
});

describe('the decisions that cannot be re-litigated by accident', () => {
  test('no GitHub Actions workflow exists (ADR-0003)', () => {
    // A workflow here is inert for deployment while looking authoritative, and
    // the platform's repository credential cannot push one — an agent that
    // adds one has its push rejected and loses the work.
    assert.equal(
      existsSync(join(REPO, '.github', 'workflows')),
      false,
      '.github/workflows must not exist — onklave.yaml is the build contract',
    );
  });

  test('no CORS configuration exists (ADR-0002)', () => {
    // The client and API are same-origin behind one gate. Reaching for
    // enableCors() means the routing is wrong, not that the policy is too tight.
    assertNoneMatch(
      serverFiles,
      (file) => (/enableCors/.test(file.code) ? `${file.path} enables CORS` : undefined),
      'the two services share a host; CORS means expose.path is wrong:',
    );
  });

  test('the agent entrypoint the manifest names exists', () => {
    const entrypoint = manifest.agent?.entrypoint;
    assert.ok(entrypoint, 'onklave.yaml must name an agent entrypoint');
    assert.ok(
      existsSync(join(REPO, entrypoint)),
      `agent.entrypoint names ${entrypoint}, which does not exist`,
    );
  });
});
