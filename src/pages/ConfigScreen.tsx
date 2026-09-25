import { missingFirebaseConfig } from '@/config/firebase';

export function ConfigScreen() {
  return (
    <div className="center-page">
      <div className="config-card">
        <div className="brand-mark">P</div>
        <h1>ตั้งค่า Firebase</h1>
        <p>
          คัดลอก <code>.env.example</code> เป็น <code>.env</code> แล้วใส่ Firebase Web App config
        </p>
        <small>Missing: {missingFirebaseConfig.join(', ')}</small>
      </div>
    </div>
  );
}
