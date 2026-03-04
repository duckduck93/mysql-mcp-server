# 0004-fix-describe-table-boolean-error-요구사항정의서

## 개요
- `describe_table` 툴 호출 시 발생하는 불리언 타입 불일치 오류를 수정한다.
- 사용자가 `describe table` 명령 시 "boolean 머시기 오류"가 난다고 보고한 원인을 해결한다.

## 사용자 요구사항
- `describe_table` 실행 시 오류 없이 정상적으로 테이블 스키마 정보를 반환해야 한다.

## 상세 요구사항
1. **오류 원인 파악 및 수정**:
   - `information_schema.columns` 조회 시 `IS_NULLABLE='YES'`의 결과는 MySQL에서 `1` 또는 `0` (TINYINT)으로 반환된다.
   - 하지만 MCP Tool의 출력 스키마(Zod)는 `nullable: z.boolean()`을 기대하므로 유효성 검사에서 실패한다.
   - 데이터베이스 조회 결과에서 `nullable` 값을 명시적으로 불리언으로 변환하도록 수정한다.
2. **테스트 강화**:
   - 해당 오류를 재현할 수 있는 테스트 케이스를 작성한다.
   - 수정 후 모든 테스트가 통과하는지 확인한다.
   - `describe_table` 관련 코드의 테스트 커버리지를 100%로 유지한다.
