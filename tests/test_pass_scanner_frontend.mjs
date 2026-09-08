import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../frontend/common/passScannerSession.js', import.meta.url), 'utf8');
const { createPassScannerSession } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const valid = name => ({ valid: true, status: 'VALID', student: { name, photo: 'data:image/jpeg;base64,official' } });

test('camera duplicates send one request and require Scan next pass', async () => {
    let resolve;
    let calls = 0;
    const results = [];
    const session = createPassScannerSession(() => { calls++; return new Promise(r => { resolve = r; }); }, r => results.push(r));
    const pending = session.scan('signed');
    await session.scan('signed'); await session.scan('another frame');
    assert.equal(calls, 1);
    resolve(valid('Alice')); await pending;
    await session.scan('signed'); assert.equal(calls, 1);
    assert.equal(results.length, 1);
    session.close();
});

test('sequential students and stale responses never mix identities', async () => {
    const pending = [];
    const results = [];
    const session = createPassScannerSession(() => new Promise(r => pending.push(r)), r => results.push(r));
    const first = session.scan('Alice');
    session.next();
    const second = session.scan('Bob');
    pending[1](valid('Bob')); await second;
    pending[0](valid('Alice')); await first;
    assert.deepEqual(results.map(r => r.student.name), ['Bob']);
    session.next();
    const third = session.scan('Carol'); pending[2](valid('Carol')); await third;
    assert.deepEqual(results.map(r => r.student.name), ['Bob', 'Carol']);
    session.close();
});

test('network failure never becomes valid', async () => {
    let received;
    const session = createPassScannerSession(async () => { throw new Error('Offline'); }, r => { received = r; });
    await session.scan('signed');
    assert.equal(received.valid, false);
    assert.equal(received.status, 'UNABLE_TO_AUTHENTICATE');
});

test('timeout fails closed and closing the page suppresses pending results', async () => {
    let received;
    const session = createPassScannerSession((token, signal) => new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Timed out', 'AbortError')));
    }), r => { received = r; }, 5);
    await session.scan('signed');
    assert.equal(received.valid, false);
    const results = [];
    let resolve;
    const closing = createPassScannerSession(() => new Promise(r => { resolve = r; }), r => results.push(r));
    const pending = closing.scan('signed'); closing.close(); resolve(valid('Alice')); await pending;
    assert.equal(results.length, 0);
});

test('malformed server response or missing official photo cannot show green', async () => {
    for (const response of [{ valid: true }, { valid: true, status: 'VALID' }, null, { valid: 'true' }]) {
        let result;
        const session = createPassScannerSession(async () => response, r => { result = r; });
        await session.scan('signed');
        assert.equal(result.valid, false);
    }
});

test('client storage and display fields have no role in scanner requests', async () => {
    globalThis.localStorage = { role: 'Driver', busId: 7, status: 'ACTIVE' };
    globalThis.indexedDB = { approved: true, studentId: 999 };
    let actual;
    const session = createPassScannerSession(async token => { actual = token; return { valid: false, status: 'WRONG_BUS' }; }, () => {});
    await session.scan('unchanged-signed-credential');
    assert.equal(actual, 'unchanged-signed-credential');
    delete globalThis.localStorage; delete globalThis.indexedDB;
});
