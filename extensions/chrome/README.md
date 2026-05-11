# Cat on Desk - AI Notifier (Chrome Extension)

ChatGPT 응답 완료 시 데스크톱 고양이에게 알림 전송.

## 설치 (개발자 모드)

1. Chrome → 주소창에 `chrome://extensions/` 입력
2. 우측 상단 **개발자 모드** ON
3. **압축해제된 확장 프로그램 로드** 클릭
4. 이 폴더(`extensions/chrome`) 선택
5. 확장 활성화 확인

## 동작 확인

1. cat-on-desk 실행 중이어야 함 (포트 23461 사용)
2. https://chatgpt.com 접속, 질문 입력
3. ChatGPT 응답 완료 시 데스크톱 고양이가 점프 + 말풍선 "ChatGPT 응답 완료"

## 지원 사이트

- chatgpt.com
- chat.openai.com

## 트러블슈팅

- 알림 안 뜸: cat-on-desk 실행 중인지, Windows 방화벽이 23461 차단했는지 확인
- 매번 안 뜸: ChatGPT가 다른 endpoint 사용했을 수도. 콘솔(F12)에서 `[catondesk] hooked ChatGPT fetch` 로그 확인
