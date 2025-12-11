# 0003-e2e-tools-tests-요구사항정의서

## Summary
- 실제 MySQL 인스턴스에 대해 MCP tool 기능을 End-to-End 수준에서 검증하는 선택적(e2e) 테스트를 추가한다.
- DB가 실행되지 않은 환경에서는 테스트가 실패하지 않고 건너뛰도록 한다.

## 요구사항
- [ ] e2e 테스트는 로컬 MySQL(호스트: localhost, 포트: 3306, 사용자: test_user, 비밀번호: sample_pass_123, 데이터베이스: test_db)을 대상으로 한다.
  - DB가 없거나 접속 실패 시 테스트는 경고 로그를 출력하고 성공으로 간주(soft skip)한다.
- [ ] 다음 MCP tool 기능을 실제 DB에 대해 순서대로 검증한다.
  1. version: 서버 버전 문자열을 반환해야 한다.
  2. show_tables: 기본(뷰 제외)과 includeViews=true 두 경우를 검증한다.
  3. describe_table: 테스트 테이블의 컬럼과 속성들을 구조화된 형태로 반환한다.
  4. show_indexes: PRIMARY 및 보조 인덱스가 구조화되어 반환되는지 확인한다.
  5. query: 조건/바인딩 파라미터 동작 및 maxRows 지정 시 truncated=true 경로 확인.
  6. explain: SELECT에 대한 실행 계획 배열을 반환한다.
  7. execute: INSERT/DDL 실행 시 affectedRows 등 메타가 반환되는지 확인한다.
- [ ] 테스트는 자체적으로 스키마/데이터를 준비하고 정리한다.
  - 생성: users 테이블, v_users 뷰, 보조 인덱스 idx_users_age
  - 데이터: 여러 행 삽입(널 포함)
  - 정리: 뷰/테이블 제거 후 커넥션 풀 종료
- [ ] 테스트는 환경 기반 기본값(타임아웃, 최대행 수 등)을 사용하되, 일부 케이스에서 값을 오버라이드하여 경계조건을 검증한다.
- [ ] 테스트 커버리지 향상을 위해 가능한 한 다양한 경로(빈 결과, 절단 여부 등)를 다룬다.

## 명확하지 않은 요구사항 및 선택지
- e2e 테스트 실행 정책(CI에서 강제 실행 여부)
  - 옵션 A. 로컬 전용(기본): DB가 없으면 항상 스킵. CI에서는 서비스 구성 시에만 동작.
    - 장점: CI 불안정성 감소, 개발자 로컬 환경 부담 적음
    - 단점: e2e가 항상 실행되지 않을 수 있음
  - 옵션 B. CI 강제: CI에서 docker-compose로 항상 MySQL을 띄워 실행.
    - 장점: 일관된 검증
    - 단점: CI 시간/리소스 증가, 설정 복잡도 상승

## UML
- Dev(개발자/CI) -> e2e tools 테스트 실행
- e2e는 MySQL에 스키마를 준비/정리하고, 각 tool(query/execute/show_tables/describe_table/show_indexes/explain/version)을 호출한다.
