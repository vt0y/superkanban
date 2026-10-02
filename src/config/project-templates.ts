/** Starter content a new project can be seeded with. Milestones carry no `dependsOn`, so nothing starts blocked. */
export interface ProjectTemplate {
  id: 'blank' | 'software';
  th: { name: string; description: string };
  en: { name: string; description: string };
  labels: { name: string; color: string }[];
  milestones: { th: string; en: string }[];
}

export const PROJECT_TEMPLATES: ProjectTemplate[] = [
  {
    id: 'blank',
    th: { name: 'โปรเจกต์ว่าง', description: 'เริ่มจากศูนย์ เพิ่มทุกอย่างเอง' },
    en: { name: 'Blank', description: 'Start from scratch and add everything yourself' },
    labels: [],
    milestones: [],
  },
  {
    id: 'software',
    th: { name: 'โปรเจกต์ซอฟต์แวร์', description: 'มี label bug/feature/design/docs และ milestone 5 ขั้นให้พร้อมใช้' },
    en: { name: 'Software project', description: 'Comes with bug/feature/design/docs labels and 5 milestones' },
    labels: [
      { name: 'bug', color: '#d73a4a' },
      { name: 'feature', color: '#0075ca' },
      { name: 'design', color: '#7057ff' },
      { name: 'docs', color: '#008672' },
    ],
    milestones: [
      { th: 'เก็บความต้องการ', en: 'Requirements' },
      { th: 'ออกแบบ', en: 'Design' },
      { th: 'พัฒนา', en: 'Build' },
      { th: 'ทดสอบ', en: 'Test' },
      { th: 'ส่งมอบ', en: 'Deliver' },
    ],
  },
];

export type ProjectTemplateId = ProjectTemplate['id'];
export const templateById = (id: ProjectTemplateId) => PROJECT_TEMPLATES.find((template) => template.id === id) ?? PROJECT_TEMPLATES[0];
