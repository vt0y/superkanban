import type { User } from 'firebase/auth';
import type { Locale, Membership, Project, Role, SiteRole, ThemeMode, UserProfile } from '@/types';

export interface AppContextValue {
  user: User;
  profile: UserProfile;
  projects: Project[];
  projectsLoaded: boolean;
  siteRole: SiteRole | null;
  locale: Locale;
  t: (key: string) => string;
  setLocale: (locale: Locale) => void;
  setTheme: (theme: ThemeMode) => void;
}

export interface SectionProps {
  context: AppContextValue;
  project: Project;
  members: Membership[];
  role: Role | null;
  readOnly: boolean;
}
