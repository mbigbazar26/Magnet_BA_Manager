import test from 'node:test'
import assert from 'node:assert/strict'
import {cloudConfig, startCloud} from './cloud.mjs'

const fixture = () => ({
  DATABASE_URL: 'postgresql://test:private@ep-example-pooler.test.neon.tech/neondb?sslmode=require',
  DATABASE_URL_UNPOOLED: 'postgresql://test:private@ep-example.test.neon.tech/neondb?sslmode=require',
  LOCAL_POSTGRES: '0', OPERATOR_PASSWORD: 'test-password-only', SESSION_SECRET: 'x'.repeat(32),
  META_PHONE_NUMBER_ID: '123', META_ACCOUNT_ID: '456', META_ACCESS_TOKEN: 'test-token',
  META_APP_SECRET: 'test-secret', META_VERIFY_TOKEN: 'test-verification',
  RENDER_EXTERNAL_URL: 'https://example.onrender.com', PORT: '10000',
})

test('cloud startup rejects incomplete or unsafe public configuration without exposing credentials', () => {
  const cases = [
    {DATABASE_URL: ''}, {LOCAL_POSTGRES: '1'}, {SESSION_SECRET: 'short'},
    {DATABASE_URL: 'postgresql://test:private@db.test/neondb?sslmode=disable'},
    {DATABASE_URL_UNPOOLED: fixture().DATABASE_URL},
    {APP_ORIGIN: 'http://example.com'}, {APP_ORIGIN: 'https://example.com/login'},
    {PORT: '0'}, {PORT: '10000;invalid'},
  ]
  for (const override of cases) assert.throws(() => cloudConfig({...fixture(), ...override}), error => !error.message.includes('private'))
})

test('migrations use the direct connection and finish before the pooled web server starts', async () => {
  const env = fixture(), calls = []
  const result = await startCloud(env, async (args, childEnv) => { calls.push({args, childEnv}); return 0 })
  assert.equal(result, 0)
  assert.equal(calls.length, 2)
  assert.equal(calls[0].childEnv.DATABASE_URL, env.DATABASE_URL_UNPOOLED)
  assert.deepEqual(calls[0].args.slice(1), ['migrate', 'deploy'])
  assert.equal(calls[1].childEnv.DATABASE_URL, env.DATABASE_URL)
  assert.equal(calls[1].childEnv.APP_ORIGIN, env.RENDER_EXTERNAL_URL)
  assert.deepEqual(calls[1].args.slice(-4), ['-H', '0.0.0.0', '-p', '10000'])
  assert.equal(env.APP_ORIGIN, undefined)
})

test('a failed migration prevents the web server from starting', async () => {
  let calls = 0
  await assert.rejects(startCloud(fixture(), async () => { calls++; return 1 }), /migrations failed/)
  assert.equal(calls, 1)
})
