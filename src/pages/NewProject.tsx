import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AppContextValue } from '@/context/AppContext';
import { PROJECT_COLORS } from '@/config/constants';
import { createProject } from '@/services/projects';
import { AppHeader } from '@/components/layout/AppHeader';

export function NewProject({ context }: { context: AppContextValue }) {
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', description: '', color: PROJECT_COLORS[0] });
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.name.trim()) return;
    setBusy(true);
    try {
      const id = await createProject(context.user, form);
      navigate(`/p/${id}/dashboard`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <AppHeader context={context} />
      <main className="narrow-page">
        <button className="back-link" onClick={() => navigate('/')}>
          ← {context.t('overview')}
        </button>
        <div className="form-card">
          <span className="eyebrow">NEW WORKSPACE</span>
          <h1>{context.t('newProject')}</h1>
          <p>กำหนดข้อมูลพื้นฐาน คุณสามารถแก้ไขภายหลังได้</p>
          <form onSubmit={submit} className="stack-form">
            <label>
              ชื่อโปรเจกต์
              <input
                autoFocus
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                maxLength={80}
                required
                placeholder="เช่น Online Booking System"
              />
            </label>
            <label>
              คำอธิบาย
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                maxLength={300}
                placeholder="เป้าหมายสั้น ๆ ของโปรเจกต์"
              />
            </label>
            <fieldset>
              <legend>สีโปรเจกต์</legend>
              <div className="color-picker">
                {PROJECT_COLORS.map((color) => (
                  <button
                    type="button"
                    key={color}
                    className={form.color === color ? 'selected' : ''}
                    style={{ background: color }}
                    onClick={() => setForm({ ...form, color })}
                    aria-label={color}
                  />
                ))}
              </div>
            </fieldset>
            <div className="form-actions">
              <button type="button" className="secondary" onClick={() => navigate('/')}>
                {context.t('cancel')}
              </button>
              <button className="primary" disabled={busy}>
                {busy ? 'กำลังสร้าง...' : context.t('newProject')}
              </button>
            </div>
          </form>
        </div>
      </main>
    </>
  );
}
