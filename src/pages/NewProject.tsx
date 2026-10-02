import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AppContextValue } from '@/context/AppContext';
import { PROJECT_COLORS } from '@/config/constants';
import { createProject } from '@/services/projects';
import { AppHeader } from '@/components/layout/AppHeader';
import { Icon } from '@/components/common/Icon';
import { toast } from '@/components/toast';
import { PROJECT_TEMPLATES, type ProjectTemplateId } from '@/config/project-templates';
import { pick } from '@/utils/formatters';

export function NewProject({ context }: { context: AppContextValue }) {
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', description: '', color: PROJECT_COLORS[0], template: 'software' as ProjectTemplateId });
  const [busy, setBusy] = useState(false);
  const { locale } = context;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.name.trim()) return;
    setBusy(true);
    try {
      const id = await createProject(context.user, { ...form, locale });
      navigate(`/p/${id}/overview`);
    } catch (error) {
      console.error(error);
      toast(pick(locale, 'สร้างโปรเจกต์ไม่สำเร็จ กรุณาลองใหม่', 'Couldn’t create the project. Please try again.'), 'error');
      setBusy(false);
    }
  };

  return (
    <>
      <AppHeader context={context} />
      <main className="narrow-page">
        <button className="back-link" onClick={() => navigate('/')}>
          <Icon name="arrowLeft" /> {context.t('overview')}
        </button>
        <div className="form-card">
          <span className="eyebrow">NEW WORKSPACE</span>
          <h1>{context.t('newProject')}</h1>
          <p>{pick(locale, 'กำหนดข้อมูลพื้นฐาน คุณสามารถแก้ไขภายหลังได้', 'Set the basics. You can change all of this later.')}</p>
          <form onSubmit={submit} className="stack-form">
            <label>
              {context.t('projectName')}
              <input
                autoFocus
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                maxLength={80}
                required
                placeholder={pick(locale, 'เช่น Online Booking System', 'e.g. Online Booking System')}
              />
            </label>
            <label>
              {context.t('projectDescription')}
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                maxLength={300}
                placeholder={pick(locale, 'เป้าหมายสั้น ๆ ของโปรเจกต์', 'A one-line goal for the project')}
              />
            </label>
            <fieldset>
              <legend>{pick(locale, 'เริ่มต้นจาก', 'Start from')}</legend>
              <div className="template-options">
                {PROJECT_TEMPLATES.map((template) => (
                  <label key={template.id} className={form.template === template.id ? 'selected' : ''}>
                    <input type="radio" name="template" value={template.id} checked={form.template === template.id} onChange={() => setForm({ ...form, template: template.id })} />
                    <span aria-hidden><Icon name={template.id === 'blank' ? 'file' : 'rocket'} /></span>
                    <span>
                      <strong>{template[locale].name}</strong>
                      <small>{template[locale].description}</small>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend>{context.t('projectColor')}</legend>
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
                {busy ? pick(locale, 'กำลังสร้าง…', 'Creating…') : context.t('newProject')}
              </button>
            </div>
          </form>
        </div>
      </main>
    </>
  );
}
