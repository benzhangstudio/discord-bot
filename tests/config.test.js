import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {loadConfig,requireConfig} from '../src/config.js';

test('direct startup loads the private environment file without replacing hosting variables',()=>{
  const file=join(tmpdir(),`number-one-config-${randomUUID()}.env`);
  try {
    writeFileSync(file,'DISCORD_TOKEN="file-test-value"\nDISCORD_APPLICATION_ID=123456789012345678\nFEED_ALLOWED_HOSTS=feeds.example\n');
    const env={DISCORD_TOKEN:'hosting-test-value'};loadConfig(env,file);
    assert.equal(env.DISCORD_TOKEN,'hosting-test-value');assert.equal(env.DISCORD_APPLICATION_ID,'123456789012345678');assert.equal(env.FEED_ALLOWED_HOSTS,'feeds.example');
    assert.doesNotThrow(()=>requireConfig(['DISCORD_TOKEN','DISCORD_APPLICATION_ID'],env));
    const blank={DISCORD_TOKEN:''};loadConfig(blank,file);assert.equal(blank.DISCORD_TOKEN,'file-test-value');
  } finally {unlinkSync(file);}
});
test('real environment variables work without an env file and errors identify missing names without values',()=>{
  const env={DISCORD_TOKEN:'private-test-value'};
  loadConfig(env,join(tmpdir(),`number-one-missing-${randomUUID()}.env`));
  assert.doesNotThrow(()=>requireConfig(['DISCORD_TOKEN'],env));
  assert.throws(()=>requireConfig(['DISCORD_TOKEN','DISCORD_APPLICATION_ID'],env),error=>error.message.includes('DISCORD_APPLICATION_ID')&&!error.message.includes('private-test-value'));
});
