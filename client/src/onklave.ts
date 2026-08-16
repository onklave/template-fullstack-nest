// Browser error tracking, wired the zero-secrets-in-the-bundle way.
//
// The bundle is public, so no key is baked in at build time. Instead the app
// asks its own API for the config: GET /api/onklave/config returns the ingest
// key when the server has one (it is rate-limited server-side and safe to
// expose to this app's own users), and 404s when error tracking is not
// configured — local dev, tests, or an environment without the key. Every
// failure path is a silent no-op: telemetry must never block or break the app.
import { OnklaveErrors } from '@onklave/errors';
import { installGlobalHandlers } from '@onklave/errors/browser';

interface OnklaveBrowserConfig {
  errorsIngestKey?: string;
  environment?: string | null;
  release?: string | null;
}

/** Fire-and-forget init — called from main.ts without awaiting. */
export async function initOnklaveBrowser(): Promise<void> {
  try {
    const res = await fetch('/api/onklave/config');
    if (!res.ok) {
      return; // 404 = error tracking not configured for this environment
    }
    const config = (await res.json()) as OnklaveBrowserConfig;
    if (!config.errorsIngestKey) {
      return;
    }
    OnklaveErrors.init({
      key: config.errorsIngestKey,
      serviceName: 'template-fullstack-nest-web',
      release: config.release || 'dev',
      environment: config.environment || 'development',
    });
    // window.onerror + unhandledrejection -> Onklave error tracking.
    installGlobalHandlers();
    // In-app feedback widget: renders ONLY when the project has end-user
    // feedback enabled (portal → project → Feedback) — the widget probes the
    // server itself. Lazy import so pages that never show it don't pay for it.
    const { installFeedbackWidget } = await import('@onklave/errors/widget');
    void installFeedbackWidget();
  } catch {
    // Offline, blocked, or malformed response — run without error tracking.
  }
}
