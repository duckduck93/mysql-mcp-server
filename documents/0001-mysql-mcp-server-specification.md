# 0001-mysql-mcp-server-개발명세서

## 프로젝트 구조/설계
- 실행 환경: Node.js (ESM), TypeScript
- 주요 라이브러리:
  - `@modelcontextprotocol/sdk`: MCP 서버 구현 (stdio transport)
  - `mysql2/promise`: MySQL 드라이버(풀/Promise API)
  - `zod`: MCP tool 입력/출력 스키마 검증
- 아키텍처 개요:
  - `src/config.ts`: 환경변수 파싱 및 설정 스키마(기본값 포함)
  - `src/db.ts`: MySQL 풀 생성/수명주기 관리, 쿼리/실행 헬퍼, 타임아웃 처리
  - `src/tools/*.ts`: 각 MCP tool 구현 (`query`, `execute`, `show_tables`, `describe_table`, `show_indexes`, `explain`, `version`)
  - `src/index.ts`: MCP 서버 초기화, tool 등록, 프로세스 종료 시 정리
  - `Dockerfile`: 런타임 이미지를 생성하고 `node dist/index.js` 를 stdio 모드로 시작

## 표준 I/O(stdio) 동작
- MCP SDK의 stdio transport를 사용한다. Node 프로세스는 포트를 개방하지 않는다.
- SIGINT/SIGTERM 수신 시 DB 풀을 종료하고 프로세스를 종료한다.

## 환경변수 스키마
- 필수: `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE`
- 선택: `MYSQL_SSL`, `MYSQL_SSL_CA_BASE64`, `MYSQL_SSL_CERT_BASE64`, `MYSQL_SSL_KEY_BASE64`, `MYSQL_TIMEZONE`, `MYSQL_CHARSET`,
  `MYSQL_CONNECT_TIMEOUT_MS`(기본 10000), `MYSQL_QUERY_TIMEOUT_MS`(기본 60000), `MYSQL_POOL_MIN`(기본 0), `MYSQL_POOL_MAX`(기본 10),
  `MAX_ROWS`(기본 10000), `LOG_LEVEL`(기본 info)
- `zod`로 파싱하며 잘못된 값은 프로세스 시작 시 에러로 처리.

## 공통 반환 포맷
- 에러는 MCP 에러 규약에 맞춰 `code`, `message`, `details`(가능 시)로 전달.
- 각 툴의 정상 반환은 아래 스키마를 따른다.

## 개발명세

### 요구사항 1: query (SELECT 전용)
- 설명: 임의의 SELECT를 실행하고 결과 행/컬럼 메타/절단 여부/소요시간을 반환.
- 입력 스키마
  ```ts
  {
    sql: string;
    params?: any[]; // 바인딩 파라미터
    maxRows?: number; // 기본 MAX_ROWS
    timeoutMs?: number; // 기본 MYSQL_QUERY_TIMEOUT_MS
  }
  ```
- 출력 스키마
  ```ts
  {
    rows: any[]; // 최대 maxRows까지만
    columns: { name: string; type: string; }[];
    truncated: boolean;
    elapsedMs: number;
  }
  ```
- 구현 포인트
  - `db.queryRows(sql, params, { timeoutMs, maxRows })`
  - `mysql2`의 `execute` 활용, `fields`에서 컬럼 메타 추출
  - 행 수가 초과되면 잘라서 `truncated: true`

### 요구사항 2: execute (DDL/DML)
- 설명: SELECT 외 SQL 실행. 영향을 받은 행 수/insertId/warningStatus 반환.
- 입력 스키마
  ```ts
  { sql: string; params?: any[]; timeoutMs?: number; }
  ```
- 출력 스키마
  ```ts
  { affectedRows: number; insertId?: number; warningStatus?: number; elapsedMs: number; }
  ```
- 구현 포인트
  - `db.execute(sql, params, { timeoutMs })`

### 요구사항 3: show_tables
- 설명: 현재 데이터베이스의 테이블(옵션: 뷰 포함) 목록 반환
- 입력 스키마
  ```ts
  { includeViews?: boolean }
  ```
- 출력 스키마
  ```ts
  { tables: { name: string; type: 'BASE TABLE' | 'VIEW' }[] }
  ```
- 구현 포인트
  - `information_schema.tables` 조회: `table_schema = DATABASE()` 조건

### 요구사항 4: describe_table
- 설명: 특정 테이블의 컬럼 스키마/코멘트 조회
- 입력 스키마
  ```ts
  { table: string }
  ```
- 출력 스키마
  ```ts
  {
    table: string;
    columns: {
      name: string;
      type: string;
      nullable: boolean;
      default: any;
      key?: string; // PRI, MUL etc.
      extra?: string;
      comment?: string;
    }[];
    tableComment?: string;
  }
  ```
- 구현 포인트
  - `information_schema.columns` + `table_constraints`는 1차 범위 제외(키는 columns의 COLUMN_KEY 사용)
  - `table`과 `column` 코멘트: `information_schema.tables.TABLE_COMMENT`, `information_schema.columns.COLUMN_COMMENT`

### 요구사항 5: DB 연결/풀 및 공통 유틸
- `createPool`로 풀 생성 (`mysql2/promise`). 선택적 SSL 지원(CA, cert/key)
- 타임아웃: 드라이버 옵션 + 유저 수준 Promise.race로 보강
- 로깅 레벨별 출력, SQL/파라미터는 디버그에서만 부분 출력(민감정보 masking 고려)

### 요구사항 6: 애플리케이션 진입점
- `src/index.ts`에서 MCP 서버 생성, 각 tool register, `stdio` transport로 serve
- 종료 훅 등록: 풀 종료

### 요구사항 7: Docker
- 멀티스테이지 빌드
  - stage1: node:20-alpine + `npm ci` + `npm run build`
  - stage2: node:20-alpine 런타임 최소 파일 복사(`/dist`, `package.json`, `node_modules(prune)`)
- 엔트리포인트: `node dist/index.js` (stdio)

### 테스트 전략
- 유닛테스트: config 파싱, 유틸 함수 단위 테스트 가능
- 통합테스트: 실제 MySQL이 필요하므로 로컬/CI에서 `services: mysql`로 구동하거나 스킵 플래그 제공
- 100% 커버리지 목표는 DB 통합 의존성으로 현실적으로 어려움 → 커버리지 예외 사유 문서화

### 변경이 필요한 파일(예정)
- `package.json`: 스크립트(`build`, `start`), 의존성(`mysql2` 추가)
- `tsconfig.json`: `outDir` 설정 확인
- `src/index.ts`: 서버 초기화/툴 등록 구현
- `src/config.ts`, `src/db.ts`, `src/tools/*.ts` 신규 추가
- `Dockerfile`, `README.md` 추가


### 요구사항 8: show_indexes
- 설명: 특정 테이블의 인덱스 목록과 컬럼/고유성/가시성/코멘트를 반환
- 입력 스키마
```ts
{ table: string }
```
- 출력 스키마
```ts
{
  table: string;
  indexes: {
    name: string;        // INDEX_NAME
    columns: string[];   // SEQ_IN_INDEX 순서대로
    unique: boolean;     // NON_UNIQUE = 0
    visible?: boolean;   // VISIBLE (MySQL 8+)
    comment?: string;    // INDEX_COMMENT
    type?: string;       // INDEX_TYPE (BTREE, FULLTEXT, etc.)
  }[];
}
```
- 구현 포인트
  - `SHOW INDEX FROM \`table\`` 또는 `information_schema.statistics` 사용
  - 동일 인덱스 이름으로 groupBy 후 `SEQ_IN_INDEX` 순서대로 columns 정렬

### 요구사항 9: explain
- 설명: SELECT 문에 대한 실행 계획을 반환
- 입력 스키마
```ts
{ sql: string; params?: any[] }
```
- 출력 스키마
```ts
{ plan: any[] } // 드라이버가 반환하는 EXPLAIN 결과 행 배열 그대로 반환
```
- 구현 포인트
  - `EXPLAIN` 접두어를 붙여 실행 (안전하게 사용자가 DML을 넣어도 EXPLAIN으로 강제)

### 요구사항 10: version
- 설명: DB 버전 문자열을 반환
- 입력 스키마
```ts
{}
```
- 출력 스키마
```ts
{ version: string }
```
- 구현 포인트
  - `SELECT VERSION() AS version` 실행

### 추가 규칙
- 단일 DB 고정: 런타임 동안 `MYSQL_DATABASE`로 지정한 하나의 DB만 사용하며, tool 호출로 DB를 변경하지 않는다.
