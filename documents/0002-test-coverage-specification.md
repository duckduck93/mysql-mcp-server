# 0002-test-coverage-개발명세서

## 프로젝트 구조/설계
- 본 프로젝트는 ESM + TypeScript 구성이며, 핵심 모듈은 다음과 같습니다.
  - `src/config.ts`: 환경변수 스키마(`zod`) 및 로딩(`loadConfig`)
  - `src/db.ts`: MySQL 풀 및 쿼리/실행/메타 쿼리 헬퍼 메서드
  - `src/tools/*.ts`: MCP 서버에 등록되는 각종 Tool 모듈 (`execute`, `show_tables`, `show_indexes`는 존재 확인)
  - `src/index.ts`: MCP 서버 생성, DB 생성, Tool 등록, 종료 시그널 처리, stdio transport 시작
- 외부 의존성
  - `@modelcontextprotocol/sdk`: MCP 서버 인터페이스 (`McpServer`, `StdioServerTransport`)
  - `mysql2/promise`: DB 연결 풀 생성 및 쿼리 수행
  - `zod`: 스키마 정의 및 검증

## 테스트 스택 및 설정 제안
- 테스트 프레임워크: Vitest (확정)
  - 이유: ESM/TS 친화, 빠른 실행, Jest 스타일 API 제공, 커버리지 지원 우수
- 환경
  - TypeScript 그대로 실행 (TS config 상 `rootDir: src`, `outDir: dist`)
  - 테스트 디렉터리: `tests/**/*.test.ts`
  - 커버리지: `100%` 임계치 (lines, branches, functions, statements 모두)
  - 전체 범위: `src/**/*` (현재 및 향후 추가 코드 포함)
  - 실행 스크립트: `"test": "vitest run --coverage"`
- 목/스텁 전략
  - `mysql2/promise`의 `createPool` 및 반환 객체 메서드(`execute`, `end`)를 완전 목
  - `@modelcontextprotocol/sdk`의 `McpServer`는 단순 목 객체(특히 `registerTool`)로 대체
  - 시간 의존성(`Date.now`, `setTimeout`)은 Vitest의 가상 타이머와 스파이로 제어
- 통합/시나리오 테스트
  - 각 파일은 단위테스트로 작성
  - 전체 시나리오 테스트는 로컬 DB (mysql://localhost:3306/user=sample&password=sample123!@#)로 읽기 전용 쿼리 수행을 시도하고, 접속 불가 시 자동 스킵

## 파일/작업 목록
1) 테스트 러너/설정 추가
- `devDependencies`: `vitest`, `ts-node`(필요 시), `@vitest/coverage-v8`
- `package.json` 스크립트/설정 갱신
- Vitest 설정 파일은 기본값 사용 또는 간단 설정(`vitest.config.ts`) 추가(ESM 지원)

2) 단위 테스트 케이스 설계 및 구현

### A. src/config.ts
커버리지 포인트 및 케이스
- `ConfigSchema` 검증 성공/실패
  - 필수 값 누락 시 에러: `MYSQL_HOST`, `MYSQL_USER`, `MYSQL_DATABASE`
  - 타입 강제 변환: `MYSQL_PORT`, `*_TIMEOUT_MS`, `POOL_MIN/MAX`, `MAX_ROWS` (`z.coerce`)
  - 기본값 확인: 포트(3306), 타임아웃, 풀 사이즈, `LOG_LEVEL`, `MYSQL_SSL: 'off'`
- `loadConfig`
  - SSL 모드: `off` => `ssl` undefined
  - `required` => `ssl` 객체 존재 + `rejectUnauthorized=false`
  - `verify_ca` => `ssl.rejectUnauthorized=true`
  - base64 로딩: `MYSQL_SSL_CA_BASE64`, `CERT`, `KEY` 존재/미존재 조합 (버퍼 길이 확인)

### B. src/db.ts
핵심 포인트
- 내부 `withTimeout` 동작 (성공/타임아웃 모두): 간접적으로 `queryRows`/`execute`에서 커버
- `queryRows(sql, params, {timeoutMs, maxRows})`
  - `fields`가 undefined일 때 컬럼 빈 배열
  - `fields`가 배열일 때 `{name, type}` 매핑 확인
  - 행 수 > `maxRows`일 때 `truncated=true` 및 slice 적용
  - `elapsedMs`가 0 이상 (spy로 `Date.now` 고정하여 정확히 일치 검증)
- `execute(sql, params, {timeoutMs})`
  - 반환의 `affectedRows`, `insertId`, `warningStatus`, `elapsedMs` 확인
  - 타임아웃 발생 시 예외
- `showTables(includeViews)`
  - 전달된 `includeViews` 값에 따라 SQL 문자열 분기 유효성 (간접 확인: `queryRows` 호출 수와 인자 캡처)
- `describeTable(table)`
  - 두 쿼리 병렬 수행 후 병합 결과의 `tableComment` 선택적 추출
- `showIndexes(table)`
  - statistics 결과를 인덱스 이름별로 그룹화하여 `columns` 순서, `unique`/`visible` 변환 로직 검증
- `explain(sql, params)`와 `version()`
  - 단순 위임 반환 경로 검증

목 방법
- `mysql2/promise`의 `createPool`을 스파이하여 가짜 풀 반환
- 가짜 풀의 `execute` 구현: 입력 SQL/파라미터에 따라 미리 준비한 결과 또는 지연 Promise
- 타임아웃 케이스: 지연 Promise + 가상 타이머로 트리거

### C. src/tools/execute.ts
- 스키마: `executeInput`/`executeOutput` zod shape 검증
- 등록: `registerTool`가 정확한 이름(`execute`)과 `inputSchema`, `outputSchema`와 함께 호출되는지
- 핸들러: `db.execute`가 올바른 인자로 호출되고, 반환 객체가 `structuredContent` 및 `content[0].text(JSON)`으로 래핑되는지
- `params`/`timeoutMs`의 기본 처리(`?? []`, `?? defaults.timeoutMs`)

### D. src/tools/show_tables.ts
- 스키마: `showTablesInput`/`showTablesOutput`
- 등록: 이름 `show_tables`
- 핸들러: `includeViews` 기본값 false 적용, 반환 구조 검증

### E. src/tools/show_indexes.ts
- 스키마: `showIndexesInput`/`showIndexesOutput`
- 등록: 이름 `show_indexes`
- 핸들러: `db.showIndexes(table)` 위임 및 반환 구조 검증

### F. src/index.ts (간접 검증)
- `McpServer` 인스턴스 생성 시 name/version 전달
- 각 `register*Tool`가 호출되는지(스파이로 각 모듈의 등록 함수 대체)
- 종료 핸들러(`SIGINT`, `SIGTERM`) 등록 여부 확인 및 `db.close` 호출 보장
  - 실제 `process.exit` 호출은 목/가로채기로 부작용 방지
- `server.connect(new StdioServerTransport())` 호출 경로

3) 커버리지 설정
- Vitest V8 커버리지 사용
- thresholds: `{ lines: 100, branches: 100, functions: 100, statements: 100 }`
- include: `src/**/*.{ts,tsx}`
- exclude: (기본 없음) — 필요 시 테스트에서 도달 불가한 엔트리 포인트의 프로세스 종료 코드는 분기별로 간접 검증하여 예외 없이 100% 달성

## 산출물
- 테스트 파일: `tests/*.test.ts`
- 설정/스크립트: `package.json` 스크립트 갱신, 필요시 `vitest.config.ts`
- 커버리지 리포트: `/coverage` 디렉터리 생성

## 오픈 이슈(사용자 확인 필요)
1. 프레임워크: Vitest로 진행해도 되는지?
2. 커버리지 대상: 현재 존재 파일만 vs `src/**/*` 전체?
3. `index.ts`가 import하지만 존재하지 않는 파일(`tools/query.ts`, `describe_table.ts`, `explain.ts`, `version.ts`) 처리 방식?
4. 통합 테스트(MySQL Docker) 포함 여부?
5. CI (GitHub Actions 등) 구성 여부?
