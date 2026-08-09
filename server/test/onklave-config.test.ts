import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { NotFoundException } from '@nestjs/common';
import { OnklaveConfigController } from '../src/onklave-config.controller';

const ENV_KEYS = ['ONKLAVE_ERRORS_INGEST_KEY', 'ONKLAVE_ENV', 'ONKLAVE_COMMIT_SHA'] as const;

describe('GET /api/onklave/config', () => {
  afterEach(() => {
    for (const key of ENV_KEYS) {
      delete process.env[key];
    }
  });

  test('404s when no ingest key is configured, so the client skips init', () => {
    const controller = new OnklaveConfigController();
    assert.throws(
      () => controller.getConfig(),
      (err: unknown) =>
        err instanceof NotFoundException && err.getStatus() === 404,
    );
  });

  test('returns the browser error-tracking config when the key is set', () => {
    process.env['ONKLAVE_ERRORS_INGEST_KEY'] = 'oek_test_123';
    process.env['ONKLAVE_ENV'] = 'production';
    process.env['ONKLAVE_COMMIT_SHA'] = 'abc123';

    assert.deepEqual(new OnklaveConfigController().getConfig(), {
      errorsIngestKey: 'oek_test_123',
      environment: 'production',
      release: 'abc123',
    });
  });

  test('nulls the optional fields when only the key is set', () => {
    process.env['ONKLAVE_ERRORS_INGEST_KEY'] = 'oek_test_123';

    assert.deepEqual(new OnklaveConfigController().getConfig(), {
      errorsIngestKey: 'oek_test_123',
      environment: null,
      release: null,
    });
  });
});
