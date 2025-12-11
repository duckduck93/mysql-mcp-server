0003-e2e-tools-tests-개발명세서

프로젝트 구조/설계(보완)
- src/tools/*.ts의 handler를 실제 MySQL에 대해 E2E로 검증
- MCP 전송은 사용하지 않고 FakeServer로 등록된 handler를 직접 호출
- 접속 실패 시 테스트는 경고 후 종료(soft skip)

개발명세
- 테스트 파일: tests/e2e.tools.local.test.ts
- 초기화: loadConfig() → createDatabase(cfg) → db.version()으로 연결 확인
- 준비: users 테이블, v_users 뷰, idx_users_age 인덱스 생성 및 샘플 데이터 삽입
- 검증: version, show_tables(뷰 포함/제외), describe_table, show_indexes, query(파라미터/절단), explain, execute(INSERT 후 COUNT 확인)
- 정리: 생성한 객체 제거 후 DB 풀 종료

테스트 전략/커버리지
- vitest 커버리지 임계치(100%)는 src 기준, 본 e2e는 실제 경로 실행으로 신뢰도 강화
- DB 비가용 환경에서는 본 e2e가 스킵될 수 있으므로 단위 테스트로 기본 커버리지 유지

비고
- docker-compose.test.yml로 로컬 MySQL을 쉽게 구동 가능
- CI에서 강제 실행하려면 워크플로우에 MySQL 서비스를 추가
