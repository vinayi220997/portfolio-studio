// Profile content model: defaults, validation and public filtering.
import { newId } from './security.js';

export const REPEATABLE = ['projects', 'experience', 'education', 'certifications', 'skills', 'links'];

export const SECTION_KEYS = ['work', 'about', 'experience', 'skills', 'education', 'certifications', 'contact'];

const str = (v, max = 500) => (v === undefined || v === null ? '' : String(v)).trim().slice(0, max);
const bool = (v, d = false) => (typeof v === 'boolean' ? v : d);
const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]{2,}$/;

export function safeUrl(v) {
  const s = str(v, 2000);
  if (!s) return '';
  if (s.startsWith('/files/') || s.startsWith('/assets/')) return s;
  try {
    const u = new URL(s);
    return ['http:', 'https:'].includes(u.protocol) ? u.toString() : '';
  } catch {
    return '';
  }
}

export function isEmail(v) {
  return EMAIL_RE.test(String(v || ''));
}

const fileId = (v) => (/^f_[A-Za-z0-9_-]{6,40}$/.test(String(v || '')) ? String(v) : '');
const id = (v, prefix) => (/^[A-Za-z0-9_-]{4,40}$/.test(String(v || '')) ? String(v) : newId(prefix));

function onePrimary(list) {
  let seen = false;
  for (const item of list) {
    if (item.primary && !seen) seen = true;
    else item.primary = false;
  }
  if (!seen && list.length) list[0].primary = true;
  return list;
}

// Returns { profile, errors }. Invalid entries are reported, not silently kept.
export function validateProfile(input) {
  const p = input && typeof input === 'object' ? input : {};
  const errors = [];

  const emails = (Array.isArray(p.emails) ? p.emails : []).slice(0, 10).map((e) => ({
    id: id(e.id, 'e_'),
    label: str(e.label, 40) || 'Email',
    address: str(e.address, 200),
    primary: bool(e.primary),
    visible: bool(e.visible, true),
  }));
  emails.forEach((e, i) => {
    if (!isEmail(e.address)) errors.push(`Email ${i + 1}: "${e.address || '(empty)'}" isn't a valid e-mail address.`);
  });

  const phones = (Array.isArray(p.phones) ? p.phones : []).slice(0, 10).map((ph) => ({
    id: id(ph.id, 'p_'),
    label: str(ph.label, 40) || 'Phone',
    number: str(ph.number, 40),
    primary: bool(ph.primary),
    visible: bool(ph.visible, true),
  }));
  phones.forEach((ph, i) => {
    if (!/^\+?[0-9 ()-]{6,25}$/.test(ph.number)) errors.push(`Phone ${i + 1}: use digits, spaces, brackets, + or - only.`);
  });

  const card = (c, prefix, fields) => {
    const out = { id: id(c?.id, prefix), published: bool(c?.published, true) };
    for (const [k, kind] of Object.entries(fields)) {
      if (kind === 'url') out[k] = safeUrl(c?.[k]);
      else if (kind === 'file') out[k] = fileId(c?.[k]);
      else if (kind === 'list') out[k] = (Array.isArray(c?.[k]) ? c[k] : String(c?.[k] || '').split(/\n|,/)).map((x) => str(x, 300)).filter(Boolean).slice(0, 20);
      else if (kind === 'long') out[k] = str(c?.[k], 2000);
      else out[k] = str(c?.[k], 200);
    }
    return out;
  };
  const list = (key, prefix, fields, max = 40) =>
    (Array.isArray(p[key]) ? p[key] : []).slice(0, max).map((c) => card(c, prefix, fields));

  const projects = list('projects', 'pr_', {
    title: 'text', year: 'text', role: 'text', summary: 'long', tags: 'list', imageFileId: 'file', imageUrl: 'url', link: 'url', linkLabel: 'text',
  });
  const experience = list('experience', 'ex_', { company: 'text', role: 'text', location: 'text', start: 'text', end: 'text', points: 'list' });
  const education = list('education', 'ed_', { school: 'text', degree: 'text', field: 'text', start: 'text', end: 'text' });
  const certifications = list('certifications', 'ce_', { name: 'text', issuer: 'text', year: 'text', link: 'url' });
  const skills = list('skills', 'sk_', { name: 'text', summary: 'long', tools: 'list' });
  const links = list('links', 'l_', { label: 'text', url: 'url' });
  links.forEach((l, i) => {
    if (!l.url) errors.push(`Link ${i + 1} ("${l.label || 'untitled'}") needs a valid https:// address.`);
  });

  const sectionsIn = Array.isArray(p.sections) ? p.sections : [];
  const sections = SECTION_KEYS.map((key) => {
    const s = sectionsIn.find((x) => x?.key === key) || {};
    return { key, title: str(s.title, 60) || defaultSectionTitle(key), visible: bool(s.visible, true) };
  }).sort((a, b) => {
    const ia = sectionsIn.findIndex((x) => x?.key === a.key);
    const ib = sectionsIn.findIndex((x) => x?.key === b.key);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });

  const r = p.resume || {};
  const resume = {
    mode: r.mode === 'url' ? 'url' : 'file',
    fileId: fileId(r.fileId),
    fileName: str(r.fileName, 160),
    url: safeUrl(r.url),
    label: str(r.label, 40) || 'Resume',
    showDownload: bool(r.showDownload, true),
    showOpen: bool(r.showOpen, true),
    showPreview: bool(r.showPreview, true),
  };
  if (r.url && !resume.url) errors.push('Resume link must be a valid https:// address.');

  const a = p.avatar || {};
  const avatar = {
    fileId: fileId(a.fileId),
    src: a.fileId ? '' : safeUrl(a.src) || '',
    alt: str(a.alt, 200),
    style: ['cutout', 'frameless', 'layered'].includes(a.style) ? a.style : 'cutout',
  };

  const logo = p.logo || {};
  const profile = {
    displayName: str(p.displayName, 80),
    titles: str(p.titles, 300),
    typing: bool(p.typing, true),
    intro: str(p.intro, 400),
    location: str(p.location, 80),
    availability: str(p.availability, 120),
    about: str(p.about, 3000),
    logo: {
      letters: str(logo.letters, 3) || initials(p.displayName),
      shape: ['square', 'circle', 'rounded'].includes(logo.shape) ? logo.shape : 'rounded',
    },
    avatar,
    emails: onePrimary(emails),
    phones: onePrimary(phones),
    links,
    resume,
    sections,
    projects,
    experience,
    education,
    certifications,
    skills,
  };
  if (!profile.displayName) errors.push('Add a display name.');
  return { profile, errors };
}

export function defaultSectionTitle(key) {
  return {
    work: 'Selected work', about: 'About', experience: 'Experience', skills: 'Skills',
    education: 'Education', certifications: 'Certifications', contact: 'Contact',
  }[key];
}

export function initials(name) {
  return String(name || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('') || 'P';
}

// Strips everything visitors shouldn't see.
export function publicView(profile) {
  const pub = (arr) => (arr || []).filter((c) => c.published);
  return {
    ...profile,
    emails: profile.emails.filter((e) => e.visible),
    phones: profile.phones.filter((p) => p.visible),
    projects: pub(profile.projects),
    experience: pub(profile.experience),
    education: pub(profile.education),
    certifications: pub(profile.certifications),
    skills: pub(profile.skills),
    links: pub(profile.links),
    sections: profile.sections.filter((s) => s.visible),
  };
}

// Every file id a profile points at (used by backup and file cleanup).
export function referencedFiles(profile) {
  const ids = new Set();
  if (profile.avatar?.fileId) ids.add(profile.avatar.fileId);
  if (profile.resume?.fileId) ids.add(profile.resume.fileId);
  for (const pr of profile.projects || []) if (pr.imageFileId) ids.add(pr.imageFileId);
  return [...ids];
}

// Seed content: taken from Vinay's resume (ramathota-vinay-resume.pdf).
// Figures are shown exactly as the resume states them; review them in the admin.
export function seedProfile() {
  return validateProfile({
    displayName: 'Ramathota Vinay',
    titles: 'UI/UX Designer, Visual Designer',
    typing: true,
    intro: 'I design intuitive, accessible interfaces for web and mobile, from research and wireframes to design systems and developer handoff.',
    location: 'Visakhapatnam, India',
    availability: '',
    about:
      "I'm a UI/UX designer with 3+ years of hands-on experience delivering intuitive, visually appealing digital products. I work in Figma with design systems and design tokens, and I lean on research, prototyping and iteration to solve complex design problems. I collaborate closely with developers, product managers and stakeholders to ship scalable, accessible, performance-minded interfaces, and I'm exploring how generative AI fits into design work.",
    logo: { letters: 'RV', shape: 'rounded' },
    avatar: { src: '/assets/avatar.webp', alt: 'Vinay, seated, wearing a denim jacket', style: 'cutout' },
    emails: [{ label: 'Work', address: 'vinayi220997@gmail.com', primary: true, visible: true }],
    phones: [{ label: 'Mobile', number: '+91 9966782923', primary: true, visible: false }],
    links: [
      { label: 'LinkedIn', url: 'https://www.linkedin.com/in/ramathota-vinay' },
      { label: 'Behance', url: 'https://www.behance.net/vinayairamatho' },
    ],
    resume: { mode: 'url', url: '', label: 'Resume', showDownload: true, showOpen: true, showPreview: true },
    sections: SECTION_KEYS.map((key) => ({ key, title: defaultSectionTitle(key), visible: true })),
    projects: [
      { title: 'Healthcare App', year: '2023–2024', role: 'UI/UX design', summary: 'End-to-end product UI for student health tracking. The resume records a 15% accessibility improvement.', tags: ['Mobile', 'Healthcare'] },
      { title: 'AI Chatbot – ATS Integration', year: '2023', role: 'UI flows', summary: 'UI flows for a chatbot that supports applicant screening, designed over one month.', tags: ['Conversational UI', 'HR tech'] },
      { title: 'Political Analytics Dashboard', year: '2023–2024', role: 'Dashboard design', summary: 'Dashboards for data visualisation and insights.', tags: ['Dashboard', 'Data viz'] },
      { title: 'SetDose', year: '', role: 'UI design', summary: 'UI design for the SetDose app.', tags: ['Mobile'] },
      { title: 'IRCTC Redesign', year: '', role: 'Concept (unofficial)', summary: 'New features added without changing the existing booking flow: Break Journey and One-Click Return Tickets.', tags: ['Concept', 'Travel'] },
      { title: 'SEO Engine', year: '', role: 'UI/UX design', summary: 'Product UI for an SEO tool.', tags: ['SaaS'] },
    ],
    experience: [
      { company: 'MST Networks', role: 'UI/UX Designer Engineer', location: 'Visakhapatnam', start: 'Jan 2025', end: 'Present', points: ['Led UI/UX design for a cybersecurity tool and internal service platforms.', 'Designed accessible interfaces across desktop and mobile.', 'Reduced design turnaround by 20% through close dev collaboration.', 'Created graphics and banners to strengthen brand visibility.'] },
      { company: 'Intelleap IT Systems', role: 'UI/UX Designer', location: 'Visakhapatnam', start: 'Jul 2024', end: 'Nov 2024', points: ['Designed over 100 icons, improving UI clarity and development handoff by 20%.', 'Optimised product interfaces for 50K+ end users.'] },
      { company: 'Vivify Healthcare', role: 'UI/UX Designer', location: 'Visakhapatnam', start: 'Feb 2023', end: 'Jul 2024', points: ['Conducted user research and usability testing.', 'Designed responsive interfaces for healthcare applications.', 'Used feedback loops and iteration to improve the experience.'] },
      { company: 'Aristocrat IT Solutions', role: 'UI Designer Intern', location: 'Remote', start: 'Nov 2022', end: 'Jan 2023', points: ['Created UI designs for promotional products.', 'Improved engagement by 30% and conversion by 20%.'] },
      { company: 'Busibud Solutions', role: 'UI/UX Designer Intern', location: 'Remote', start: 'Aug 2022', end: 'Oct 2022', points: ['Developed SaaS wireframes and web mock-ups.'] },
    ],
    education: [{ school: 'Raghu Engineering College', degree: 'BTech', field: 'Mechanical Engineering', start: '2016', end: '2021' }],
    certifications: [
      { name: 'Certified UI/UX Designer', issuer: '', year: '2021' },
      { name: 'Certified WordPress Designer', issuer: '', year: '2024' },
      { name: 'Workshop: AI in Design', issuer: '', year: '2025' },
    ],
    skills: [
      { name: 'UX design', summary: 'User-centred experiences across web and mobile, grounded in usability principles, journeys and personas.', tools: ['User flows', 'Empathy mapping', 'Journey mapping'] },
      { name: 'Wireframing & prototyping', summary: 'Low- to high-fidelity wireframes and interactive prototypes that validate concepts before development.', tools: ['Figma', 'Adobe XD', 'Clickable prototypes'] },
      { name: 'Design systems', summary: 'Consistent systems, style guides and reusable components across products.', tools: ['Design tokens', 'Component libraries', 'UI kits'] },
      { name: 'Accessibility & responsive design', summary: 'Inclusive interfaces optimised for every screen size.', tools: ['Responsive grid', '60:30:10 rule'] },
      { name: 'Usability testing', summary: 'Testing sessions and iteration based on feedback.', tools: ['Usability studies', 'A/B testing', 'Feedback analysis'] },
      { name: 'HTML & CSS', summary: 'Enough front-end to collaborate closely with developers and smooth handoff.', tools: ['HTML5', 'CSS3', 'Flexbox', 'Grid', 'Webflow'] },
      { name: 'Collaboration', summary: 'Turning business goals into design with developers, PMs and stakeholders.', tools: ['Stand-ups', 'Product design'] },
      { name: 'Strategy & AI', summary: 'Design strategy and emerging tools such as generative AI and design automation.', tools: ['Generative AI', 'Strategy'] },
    ],
  }).profile;
}

export const DEFAULT_THEME = {
  mode: 'system', // light | dark | system | browser
  accent: '#0D7EF2',
  background: { type: 'canvas', solid: '#EEF0F3', gradient: { from: '#E8ECFF', to: '#F6EEFF', angle: 135, animate: false } },
};

export function validateTheme(t) {
  const hex = (v, d) => (/^#[0-9a-fA-F]{6}$/.test(String(v || '')) ? String(v).toUpperCase() : d);
  const bg = t?.background || {};
  const g = bg.gradient || {};
  return {
    mode: ['light', 'dark', 'system', 'browser'].includes(t?.mode) ? t.mode : DEFAULT_THEME.mode,
    accent: hex(t?.accent, DEFAULT_THEME.accent),
    background: {
      type: ['canvas', 'solid', 'gradient'].includes(bg.type) ? bg.type : 'canvas',
      solid: hex(bg.solid, DEFAULT_THEME.background.solid),
      gradient: {
        from: hex(g.from, DEFAULT_THEME.background.gradient.from),
        to: hex(g.to, DEFAULT_THEME.background.gradient.to),
        angle: Math.max(0, Math.min(360, Number.isFinite(Number(g.angle)) ? Number(g.angle) : 135)),
        animate: bool(g.animate, false),
      },
    },
  };
}
