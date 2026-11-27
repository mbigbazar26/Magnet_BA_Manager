import test from 'node:test'
import assert from 'node:assert/strict'
import {isSameOrigin, publicOrigin, makeSession, validSession} from '../lib/auth.ts'

test('hosted login uses the HTTPS public origin through an HTTP reverse proxy', () => {
  const previous = {...process.env}
  try {
    process.env.RENDER_EXTERNAL_URL = 'https://example.onrender.com'
    delete process.env.APP_ORIGIN
    const request = new Request('http://internal:10000/api/session', {
      headers: {host: 'internal:10000', origin: 'https://example.onrender.com'},
    })
    assert.equal(isSameOrigin(request), true)
    assert.equal(publicOrigin(request), 'https://example.onrender.com')
    assert.equal(isSameOrigin(new Request(request, {headers: {origin: 'https://attacker.example'}})), false)
    assert.equal(isSameOrigin(new Request(request.url)), false)
    process.env.APP_ORIGIN = 'https://desk.example.com'
    assert.equal(isSameOrigin(request), false)
    assert.equal(publicOrigin(request), 'https://desk.example.com')
    assert.equal(isSameOrigin(new Request(request, {headers: {origin: 'https://desk.example.com'}})), true)
  } finally {
    for (const key of ['APP_ORIGIN', 'RENDER_EXTERNAL_URL']) {
      if (previous[key] === undefined) delete process.env[key]
      else process.env[key] = previous[key]
    }
  }
})

test('local login still accepts its matching host and rejects a different port', () => {
  const previous = {...process.env}
  try {
    delete process.env.APP_ORIGIN
    delete process.env.RENDER_EXTERNAL_URL
    const req = new Request('http://127.0.0.1:3000/api/session', {headers: {
      host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000',
    }})
    assert.equal(isSameOrigin(req), true)
    assert.equal(publicOrigin(req), 'http://127.0.0.1:3000')
    assert.equal(isSameOrigin(new Request(req, {headers: {host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3001'}})), false)
  } finally {
    for (const key of ['APP_ORIGIN', 'RENDER_EXTERNAL_URL']) {
      if (previous[key] === undefined) delete process.env[key]
      else process.env[key] = previous[key]
    }
  }
})

test('sessions signed with one cloud secret cannot be used after rotating it', () => {
  const previous = process.env.SESSION_SECRET
  try {
    process.env.SESSION_SECRET = 'a'.repeat(32)
    const token = makeSession()
    assert.equal(validSession(token), true)
    process.env.SESSION_SECRET = 'b'.repeat(32)
    assert.equal(validSession(token), false)
  } finally {
    if (previous === undefined) delete process.env.SESSION_SECRET
    else process.env.SESSION_SECRET = previous
  }
})
