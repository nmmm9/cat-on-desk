---
template: plan
version: 1.2
feature: cat-desktop-pet
date: 2026-05-08
author: MG
project: cat-on-desk
project-version: 0.0.1
---

# cat-desktop-pet Planning Document

> **Summary**: 데스크톱 화면 위에 떠 있으면서 사용자의 마우스/키보드 활동과 활성 앱에 반응하는 고양이 데스크톱 펫.
>
> **Project**: cat-on-desk
> **Version**: 0.0.1
> **Author**: MG
> **Date**: 2026-05-08
> **Status**: Draft

---

## 1. Overview

### 1.1 Purpose

CLI에 한정되지 않은 **일상 컴퓨터 사용**(웹서핑, 문서 작업, 영상 시청, 코딩 등) 전반에 반응하는 데스크톱 마스코트를 만든다. 사용자가 컴퓨터를 켜고 일하는 동안 옆에서 살아있는 고양이가 함께 있는 듯한 경험 제공.

### 1.2 Background

기존 [clawd-on-desk](../../../../clawdondesk/clawd-on-desk) 프로젝트가 Claude Code/Codex 같은 CLI 도구의 훅 이벤트에만 반응한다는 한계를 가짐. 본 프로젝트는 OS-level 활동 감지로 일반 사용자에게도 의미 있는 펫을 만든다.

### 1.3 Related Documents

- 레퍼런스 아키텍처: `C:\Users\MG\Desktop\Project\clawdondesk\clawd-on-desk` (AGPL-3.0, 코드 직접 차용 금지·아이디어만 참조)
- PoC 결과: 본 프로젝트 `src/` 1단계 구현 (활동 감지 + 앱 감지 동작 확인됨)

---

## 2. Scope

### 2.1 In Scope (v0.1 마일스톤)

- [ ] Windows 10/11 지원 (1차 타겟)
- [ ] 마우스/키보드 활동 감지 → `active`/`idle`/`sleeping` 상태 전환
- [ ] 키 입력과 마우스 입력 분리 감지 → `typing`/`mousing` 상태
- [ ] Foreground 앱 EXE 감지
- [ ] Foreground 윈도우 타이틀 기반 브라우저 사이트 식별 (YouTube, Notion 웹, Figma 웹, GitHub 등)
- [ ] 앱 → 카테고리 매핑 (사용자 편집 가능 JSON)
- [ ] 카테고리별 펫 모션 변화 (코딩/영상/문서/브라우징/게임 등)
- [ ] 펫 옆 작은 앱 로고 배지
- [ ] 트레이 아이콘 + 종료 메뉴
- [ ] 항상 위, 투명, 클릭 통과(드래그 영역만 잡음) 윈도우
- [ ] 고양이 캐릭터 1종 + 6~10개 모션 GIF/SVG

### 2.2 Out of Scope (v0.1 제외)

- macOS / Linux 지원 (v0.2+)
- 사용자 입력 키 내용 저장·전송 (절대 안 함)
- 다중 캐릭터 동시 표시
- 캐릭터 커스터마이즈 UI (JSON 직접 편집만 v0.1)
- CLI 훅 통합 (clawd-on-desk와 별개 프로젝트)
- 클라우드 동기화·계정·통계
- 펫과 상호작용(클릭해서 놀기 등) — v0.2+

---

## 3. Requirements

### 3.1 Functional Requirements

| ID | 요구사항 | 우선순위 | 상태 |
|----|----------|----------|------|
| FR-01 | 마우스/키보드 입력 감지 (글로벌, 모든 앱) | High | PoC 완료(통합) |
| FR-02 | 입력 종류 구분 (키 vs 마우스) | High | Pending |
| FR-03 | 일정 시간 무입력 시 sleeping 상태 | High | Pending |
| FR-04 | Foreground 앱 EXE 이름 감지 | High | PoC 완료 |
| FR-05 | 윈도우 타이틀로 브라우저 사이트 식별 | High | PoC 완료(타이틀까진) |
| FR-06 | 앱 → 카테고리 매핑 룰 (사용자 편집 가능) | High | Pending |
| FR-07 | 상태 + 카테고리 → GIF 매핑 | High | Pending |
| FR-08 | 펫 윈도우: 항상 위, 투명, 프레임 없음 | High | PoC 완료 |
| FR-09 | 펫 옆 앱 로고 배지 표시 | Medium | Pending |
| FR-10 | 트레이 아이콘 (종료/설정) | Medium | Pending |
| FR-11 | 자동 시작 옵션 | Low | Pending |
| FR-12 | 펫 위치 드래그로 이동·저장 | Medium | Pending |
| FR-13 | 입력 모니터링 권한·정책 안내(첫 실행 시) | High | Pending |

### 3.2 Non-Functional Requirements

| 카테고리 | 기준 | 측정 방법 |
|----------|------|-----------|
| 성능 | 펫 렌더링 CPU < 2% (idle), < 5% (active) | 작업 관리자 |
| 성능 | 활동 감지 폴링이 입력 지연 일으키지 않음 | 체감 + perfmon |
| 메모리 | RSS < 200MB | 작업 관리자 |
| 프라이버시 | 키스트로크 내용·URL·입력 데이터를 디스크/네트워크로 보내지 않음 | 코드 리뷰, 자체 감사 |
| 안정성 | 24시간 연속 동작에 메모리 누수 없음 | 장기 모니터링 |
| 사용성 | 첫 실행 후 5초 안에 펫 표시 | 수동 측정 |

---

## 4. Success Criteria

### 4.1 Definition of Done (v0.1)

- [ ] FR-01~FR-10, FR-13 모두 구현
- [ ] 노션 데스크톱·노션 웹·유튜브·VS Code·크롬 일반 페이지에서 각각 다른 모션 또는 배지 표시 확인
- [ ] 24시간 연속 실행 후 메모리 누수 없음
- [ ] README 작성 (한국어)
- [ ] 라이선스 결정 및 LICENSE 파일

### 4.2 Quality Criteria

- [ ] PoC 코드 → 모듈 분리(`activity/`, `state/`, `mapping/`, `renderer/`) 완료
- [ ] 매핑 룰 JSON이 코드 변경 없이 추가/수정 가능
- [ ] 알 수 없는 EXE에 대해 합리적 기본값(`unknown`) 폴백
- [ ] 펫 윈도우가 다른 전체화면 앱(게임/영상)과 충돌 시 기본 동작 정의됨

---

## 5. Risks and Mitigation

| 리스크 | 영향 | 가능성 | 완화책 |
|--------|------|--------|--------|
| 글로벌 입력 후킹이 보안 SW에 차단 | High | Medium | `GetLastInputInfo` 폴링(후킹 아님) 사용 — PoC에서 채택 완료 |
| 키/마우스 구분 시 글로벌 훅 필요 → 백신 false positive | Medium | Medium | uiohook-napi 등 검증된 패키지 사용. 또는 Raw Input API. 안 되면 v0.1엔 통합 active/idle만 |
| 윈도우 타이틀이 비어있거나 다국어인 케이스 | Medium | High | 타이틀 + EXE 함께 사용, 다국어 키워드 매핑(영문 + 한글) |
| Electron + native binding 빌드/배포 복잡 | Medium | Medium | electron-builder + 네이티브 모듈 rebuild 자동화. CI 도입은 v0.2 |
| 사용자 프라이버시 우려 | High | Low | 코드/문서로 "입력 내용 저장 안 함" 명시, 오프라인 100% 동작 |
| 24/7 실행 시 메모리 누수 | High | Medium | 폴링 인터벌·핸들 close 코드 리뷰, koffi 핸들 명시적 해제 |
| AGPL-3.0 레퍼런스 코드 우발적 차용 | High | Low | clawd-on-desk 코드는 읽기 전용으로만 참조, 새 코드는 직접 작성 |

---

## 6. Architecture Considerations

### 6.1 Project Type

본 프로젝트는 bkit의 웹 중심 Starter/Dynamic/Enterprise 분류에 직접 해당하지 않는 **Electron 데스크톱 앱**.

| 분류 | 본 프로젝트 적용 |
|------|-----------------|
| 백엔드 | 없음 (로컬 전용) |
| 프론트엔드 | Electron renderer (HTML/CSS/JS, 단일 윈도우) |
| 메인 프로세스 | Node.js (Electron main) — 활동 감지·상태 관리 담당 |
| 네이티브 호출 | koffi(FFI)로 Win32 API 직접 호출 |

### 6.2 Key Architectural Decisions

| 결정 | 옵션 | 선택 | 근거 |
|------|------|------|------|
| 데스크톱 런타임 | Electron / Tauri / Native Win32 | **Electron** | Tauri는 native binding이 까다로움. 레퍼런스도 Electron. 빠른 PoC 우선 |
| 입력 감지 방식 | uiohook-napi / koffi+Raw Input / GetLastInputInfo | **GetLastInputInfo (PoC) → uiohook-napi (정밀화)** | 단계적 도입. 키/마우스 구분 필요할 때 업그레이드 |
| 앱 감지 방식 | active-win 패키지 / koffi 직접 호출 | **koffi 직접 호출** | 의존성 최소화, 이미 PoC 동작 |
| 상태 머신 | XState / 직접 작성 | **직접 작성** | 상태 수 적음(~10개), 외부 라이브러리 과함 |
| 렌더링 | DOM + GIF/SVG / Canvas / WebGL | **DOM + GIF (or APNG)** | 간단·테마 교체 쉬움. 추후 Lottie도 검토 |
| 스타일링 | Tailwind / 순수 CSS | **순수 CSS** | 단일 윈도우라 빌드 도구 불필요 |
| 매핑 룰 저장 | 하드코딩 / JSON / SQLite | **JSON** | 사용자 편집 친화 |
| 패키징 | electron-builder / electron-forge | **electron-builder** | 표준, NSIS 지원 |
| 라이선스 | MIT / Apache-2.0 / AGPL | **MIT** | 자유로운 재사용. 레퍼런스(AGPL)와 격리 |

### 6.3 Folder Structure (목표)

```
catondesk/
├── package.json
├── docs/
│   ├── 01-plan/features/cat-desktop-pet.plan.md
│   └── 02-design/features/cat-desktop-pet.design.md
├── src/
│   ├── main.js                       # Electron 진입점
│   ├── preload.js                    # contextBridge
│   ├── activity/                     # OS 활동 감지
│   │   ├── input-monitor.js          # 마우스/키보드
│   │   └── foreground-app.js         # 활성 앱
│   ├── state/                        # 상태 머신
│   │   ├── state-machine.js
│   │   └── state-priority.js
│   ├── mapping/                      # 룰 기반 매핑
│   │   ├── app-rules.json            # 사용자 편집 가능
│   │   └── resolve-app.js
│   ├── theme/                        # 캐릭터 테마
│   │   ├── default-cat/
│   │   │   ├── theme.json
│   │   │   └── *.gif
│   │   └── theme-loader.js
│   └── renderer/
│       ├── index.html
│       ├── style.css
│       └── renderer.js
└── assets/
    └── icons/                        # 트레이 아이콘
```

### 6.4 데이터 흐름

```
[OS 입력 이벤트]                    [Foreground 변경]
     |                                    |
  input-monitor.js ──┐         ┌── foreground-app.js
                     ↓         ↓
                  state-machine.js (입력 상태 + 앱 카테고리 통합)
                              |
                       resolve-app.js (EXE/타이틀 → 카테고리/로고)
                              |
                       theme-loader.js (상태+카테고리 → GIF 파일)
                              |
                          IPC → renderer
                              |
                       <펫 윈도우에 GIF + 배지>
```

### 6.5 상태 머신 (초안)

기본 상태:
- `sleeping` — 60초 이상 무입력
- `idle` — 3~60초 무입력
- `active` — 최근 3초 내 입력 있음 (키/마우스 미구분 폴백)
- `typing` — 키보드 입력 중 (uiohook 도입 후)
- `mousing` — 마우스 입력 중 (uiohook 도입 후)
- `surprised` — 앱 전환 직후 짧은 트랜지션 (1초)
- `playing` — 게임 EXE 활성 시
- `coding` — IDE 활성 + typing
- `watching` — 영상 앱/사이트 활성
- `reading` — 문서·브라우징 활성

우선순위(높음 → 낮음): `surprised` > `coding` > `playing` > `watching` > `typing`/`mousing` > `active` > `idle` > `sleeping`

---

## 7. Convention Prerequisites

### 7.1 기존 컨벤션

- [ ] `CLAUDE.md` — 미생성 (필요)
- [x] PoC 코드 작성 패턴: CommonJS + 화살표 함수 + 명시적 export
- [ ] ESLint/Prettier — v0.2에 도입

### 7.2 정의·확인할 컨벤션

| 카테고리 | 현재 상태 | 정의 내용 | 우선순위 |
|----------|-----------|-----------|----------|
| **모듈 시스템** | CommonJS 채택 (Electron 호환성) | 모든 파일 `require`/`module.exports` | High |
| **파일 명명** | 미정 | kebab-case (예: `input-monitor.js`) | High |
| **함수 명명** | 미정 | `start*`/`stop*`/`read*` 동사 prefix | High |
| **상수** | 미정 | UPPER_SNAKE_CASE, 모듈 상단 선언 | Medium |
| **로깅** | console.log 임시 사용 | v0.1엔 console, v0.2에 로거 도입 | Low |
| **비동기** | Promise 또는 콜백 — 모듈별 일관 | input/foreground는 콜백, IPC는 Promise | Medium |
| **에러 처리** | 시스템 호출 실패 시 null 반환 + 호출측 폴백 | 활동 감지가 실패해도 앱 죽지 않게 | High |
| **프라이버시 가드** | 입력 내용·URL·타이틀 원문은 메인 프로세스 밖으로 안 나감 | renderer에는 분류 결과만 전달 | High |

### 7.3 환경 변수

| 변수 | 용도 | 범위 | 생성 필요 |
|------|------|------|----------|
| (없음 v0.1) | 모든 설정은 JSON 룰 파일 또는 사용자 설정 | - | - |

### 7.4 Pipeline Integration

bkit 9-phase Pipeline 중 본 프로젝트에 의미 있는 단계:

| Phase | 적용 | 비고 |
|-------|------|------|
| Phase 1 (Schema) | 일부 | 상태·카테고리·매핑 룰 스키마 정의 (Design 단계에서 진행) |
| Phase 2 (Convention) | 적용 | §7.2 항목으로 대체 |
| Phase 3 (Mockup) | 적용 | 캐릭터·UI 와이어프레임 (3단계 캐릭터 컨셉에서 진행) |
| Phase 4 (API) | 미적용 | 백엔드 없음 |
| Phase 5 (Design System) | 일부 | 단일 펫 윈도우라 컴포넌트 시스템 불필요, 테마 JSON 스키마는 정의 |
| Phase 6 (UI Integration) | 적용 | renderer ↔ main IPC 통합 |
| Phase 7 (SEO/Security) | 일부 | 보안만 적용 (프라이버시 자체 감사) |
| Phase 8 (Review) | 적용 | gap-detector로 Design vs 구현 검증 |
| Phase 9 (Deployment) | 적용 | electron-builder NSIS 패키징 |

---

## 8. Milestones

| 마일스톤 | 내용 | 산출물 |
|----------|------|--------|
| M1 (완료) | PoC: 활동 감지 + 앱 감지 + Electron 골격 | `src/` 1차 코드 |
| M2 | Plan 문서 (현재 단계) | 본 문서 |
| M3 | Design 문서 + 캐릭터 컨셉 정의 | `docs/02-design/`, 캐릭터 명세 |
| M4 | 캐릭터 GIF 제작/확보 | `src/theme/default-cat/*.gif` |
| M5 | 상태 머신·매핑 룰·렌더러 통합 | v0.1.0 internal |
| M6 | 트레이·자동시작·드래그 위치 저장 | v0.1.0 release candidate |
| M7 | 24시간 안정성 테스트 + README | v0.1.0 release |

---

## 9. Next Steps

1. [x] PoC 검증
2. [ ] **본 Plan 문서 사용자 검토**
3. [ ] Design 문서 작성 (`/pdca design cat-desktop-pet`)
   - 상태 머신 상세 다이어그램
   - 매핑 룰 JSON 스키마
   - IPC 메시지 포맷
   - 테마 JSON 스키마
4. [ ] 캐릭터 컨셉 정의 (3단계)
5. [ ] 구현 진행 (`/pdca do cat-desktop-pet`)

---

## Version History

| 버전 | 날짜 | 변경사항 | 작성자 |
|------|------|----------|--------|
| 0.1 | 2026-05-08 | 최초 작성 (PoC 결과 반영) | MG |
