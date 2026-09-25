import { useState } from 'react';
import { getAllowedDomainsLabel, getDomainErrorMessage } from '@/config/auth-domains';

export function LoginScreen({
  onLogin,
  errorMessage = '',
}: {
  onLogin: () => Promise<unknown>;
  errorMessage?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const displayError = error || errorMessage;
  const domainsLabel = getAllowedDomainsLabel();

  const login = async () => {
    setBusy(true);
    setError('');
    try {
      await onLogin();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      if (msg === 'DOMAIN_NOT_ALLOWED') {
        setError(getDomainErrorMessage());
      } else {
        setError('เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่');
      }
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-visual">
        <div className="visual-copy">
          <span className="product-pill">PROJECTSPACE</span>
          <h1>
            ทุกโปรเจกต์
            <br />
            <em>เดินหน้าไปด้วยกัน</em>
          </h1>
          <p>งาน ทีม โน้ต และเป้าหมาย อยู่ใน workspace เดียว</p>
        </div>
        <div className="floating-board">
          <i />
          <i />
          <i />
        </div>
      </div>
      <div className="login-panel">
        <div className="login-box">
          <div className="brand">
            <span className="brand-mark">P</span>
            <strong>ProjectSpace</strong>
          </div>
          <h2>ยินดีต้อนรับ</h2>
          <p>เข้าสู่ระบบเพื่อดูโปรเจกต์ของคุณ</p>
          <button className="google-button" onClick={login} disabled={busy}>
            <b>G</b>
            {busy ? 'กำลังเข้าสู่ระบบ...' : 'ดำเนินการต่อด้วย Google'}
          </button>
          {displayError && <p className="form-error">{displayError}</p>}
          <small>
            การเข้าสู่ระบบถือว่าคุณยอมรับการทำงานร่วมกันภายในทีม
            {domainsLabel ? ` (เฉพาะบัญชี ${domainsLabel})` : ''}
          </small>
        </div>
      </div>
    </div>
  );
}
