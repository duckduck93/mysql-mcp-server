#!/usr/bin/env node
// profiles.json 의 프로파일별로 OS 키체인 등록 상태를 보여주고, 빠진 것의 등록 명령을 안내한다.
//
//   node scripts/keychain.mjs [profiles.json 경로]
//
// 비밀번호 값은 읽지 않는다. 속성만 조회하므로 승인 창이 뜨지 않는다.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';

const SERVICE_PREFIX = 'mysql-mcp';
const PLACEHOLDER = /^<.*>$/;

const file = path.resolve(process.argv[2] ?? 'profiles.json');

if (process.platform !== 'darwin') {
  console.error(`이 도구는 macOS 키체인 전용이다(현재 ${process.platform}).`);
  console.error('다른 플랫폼은 MYSQL_SECRET_SOURCE=env 로 두고 MYSQL_PASSWORD 를 설정한다.');
  process.exit(1);
}

if (!fs.existsSync(file)) {
  console.error(`${file} 이 없다. profiles.example.json 을 복사해 만든다.`);
  process.exit(1);
}

const profiles = JSON.parse(fs.readFileSync(file, 'utf8'));

/** 값을 읽지 않고 항목 존재 여부만 본다. -w 를 주지 않으면 ACL 승인이 필요 없다. */
function isRegistered(service, account) {
  return new Promise(resolve => {
    execFile('/usr/bin/security', ['find-generic-password', '-s', service, '-a', account], err =>
      resolve(!err));
  });
}

const rows = [];
for (const [name, profile] of Object.entries(profiles)) {
  const service = `${SERVICE_PREFIX}/${name}`;
  const account = profile.user ?? '';
  const incomplete = !account || PLACEHOLDER.test(account) || PLACEHOLDER.test(String(profile.host ?? ''));
  const registered = incomplete ? false : await isRegistered(service, account);
  rows.push({ name, service, account, production: profile.production === true, incomplete, registered });
}

const width = Math.max(...rows.map(r => r.name.length));
console.log(`\n프로파일 ${rows.length}개 · ${file}\n`);
for (const r of rows) {
  const mark = r.registered ? '  등록됨' : r.incomplete ? '  접속정보 미확보' : '  등록 필요';
  const tag = r.production ? ' (운영)' : '';
  console.log(`  ${r.name.padEnd(width)}  ${r.service}${tag}`);
  console.log(`  ${' '.repeat(width)}  계정 ${r.account || '(없음)'} —${mark}`);
}

const todo = rows.filter(r => !r.registered);
if (todo.length === 0) {
  console.log('\n전부 등록돼 있다.');
  // 항목의 ACL 은 키체인 전체를 덤프하지 않으면 읽을 수 없다. 존재만 확인한 것이므로
  // -T "" 가 걸렸는지는 여기서 알 수 없다는 사실을 숨기지 않는다.
  console.log('다만 -T "" 가 걸렸는지는 확인할 수 없다 — 항목의 존재만 본다.');
  console.log('확실히 하려면 지우고 다시 등록한다.\n');
  for (const r of rows) {
    console.log(`  ${r.name}${r.production ? ' (운영)' : ''}`);
    console.log(`      security delete-generic-password -s "${r.service}" -a "${r.account}"`);
    console.log(`      security add-generic-password -U -s "${r.service}" -a "${r.account}" -T "" -w`);
  }
  console.log('\n  -T "" 를 뺀 항목은 Agent 가 비밀번호를 그냥 읽어 갈 수 있다.');
  console.log('  무인 실행(스케줄러 등)에서 쓰는 프로파일만 개인 판단으로 뺀다.\n');
  process.exit(0);
}

console.log(`\n등록이 필요한 항목이 ${todo.length}개 있다.\n`);
for (const r of todo) {
  if (r.incomplete) {
    console.log(`  ${r.name} — profiles.json 의 host·user 를 먼저 채운다. 지금은 자리표시자다.`);
    continue;
  }
  // -T "" 로 신뢰 앱 목록을 비워야 접근할 때마다 승인 창이 뜬다.
  // 이걸 빼면 security 를 부를 수 있는 아무 프로세스나(Agent 포함) 조용히 읽어 간다.
  console.log(`  ${r.name}${r.production ? ' (운영)' : ''}`);
  console.log(`      security add-generic-password -U -s "${r.service}" -a "${r.account}" -T "" -w`);
}

console.log('\n  -w 뒤에 값을 적지 않으면 대화형으로 물어보므로 셸 히스토리에 남지 않는다.');
console.log('  -T "" 는 접근할 때마다 승인 창을 띄운다. 빼면 Agent 가 비밀번호를 그냥 읽어 갈 수 있다.');
console.log('  승인 창에서 [항상 허용]을 누르면 그 보호가 영구히 풀린다. [허용]만 누른다.');
console.log('  비밀번호는 풀을 만들 때 한 번만 읽으므로, 창은 프로파일당 세션에 한 번 뜬다.');
console.log('  무인 실행(스케줄러 등)에서 쓰는 프로파일은 개인 판단으로 -T "" 를 빼도 된다.\n');
