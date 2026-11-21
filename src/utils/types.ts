export type Theme = "modern" | "custom";

export interface Profile {
  name: string;
  title: string;
  summary: string;
  location: string;
  address?: string;
  url: string;
  photo?: string;
}

export interface Experience {
  id: string;
  company: string;
  role: string;
  startDate: string;
  endDate: string;
  description: string;
}

export interface Education {
  id: string;
  institution: string;
  degree: string;
  year: string;
}

export interface Skill {
  id: string;
  name: string;
  category: "frontend" | "backend" | "tools" | "other";
  level?: number; // Percentage 0-100
}

export interface Language {
  id: string;
  language: string;
  proficiency: string; // e.g. Native, Fluent, Intermediate
}

export interface Certification {
  id: string;
  name: string;
  year: string;
}

export interface Contact {
  email: string;
  phone: string;
  linkedin?: string;
  github?: string;
  website?: string;
}

export interface CVData {
  profile: Profile;
  experience: Experience[];
  education: Education[];
  skills: Skill[];
  languages: Language[];
  certifications: Certification[];
  contact: Contact;
}

export const INITIAL_CV_DATA: CVData = {
  // ... existing profile ...
  profile: {
    name: "Chong Wei Hon",
    title: "Scrum Master Certified (SMC)",
    summary:
      "Initially I’m from hardware & network infrastructure field, in year 2008 I got an opportunity to change my career from hardware to become a software developer, I known is a big contrast but it makes my life different. I’m truly believe that continuous learn will lead me to another level, therefore I attended Scrum Master Certified course, and now I am a certified Scrum Master.",
    location: "Selangor, Malaysia",
    address:
      "No. 19, Jalan PP5, Taman Pinggiran Putra, 43300 Seri Kembangan, Selangor. Malaysia",
    url: "https://www.linkedin.com/in/chong-wei-hon-976026ab/",
    photo: "/profile.jpg",
  },
  experience: [
    {
      id: "1",
      company: "n2n connect bhd",
      role: "Senior Software Engineer",
      startDate: "Sept 2019",
      endDate: "Present",
      description:
        "Here, I act as a development member of top-ranking trading application in market. My responsibility is to maintain existing trading application and in coming future migrate existing code base which return by Delphi currently to JavaScript as per plan.\n\nThis team working style is different compare with my all previous development experience, here is more specialized on application development. We didn’t take care for database development.\n\nCoding style here is more on object-oriented approach, and I got my 1st chance to develop my own component.\n\nMy significant contribution for this few months as below:\n- Develop trade calculator.\n- Develop advance search for trading transaction.\n- Migrating application connection to JSON format connection.",
    },
    {
      id: "2",
      company: "MBf Holdings Bhd.",
      role: "Project Manager",
      startDate: "Jul 2017",
      endDate: "Jul 2019",
      description:
        "As a project manager, my main focus is handling Retail & POS system project for client based in Fiji by collaboration with IT team based in Fiji. These 2 systems have been implemented more than 10 years in Fiji.\n\nBeside of project management, my 2nd responsibility is to stabilize these 2 systems by fixing bug encounter and also managing new enhancement if required.\n\nWithin my service period, significant project handled by me is:\n- Implement auto upgrade feature.\n- Certified POS system with latest tax monitoring system enforce by Fiji government.",
    },
    {
      id: "3",
      company: "CompuGroup Medical Malaysia",
      role: "Senior Software Engineer",
      startDate: "Jun 2015",
      endDate: "Jun 2017",
      description:
        "As a senior software engineer, my main responsibility is to collaborate with the team to maintain and enhance our medical solution in order to make it more competitive in market.\n\nThis is my 1st contact point with scrum methodology because we are practicing scrum methodology for our project. We having scrum event like daily huddle, product backlog grooming, sprint planning, retrospective, sprint review and etc. We didn’t have scrum master for this team therefore we can participate to scrum master activity.\n\nBeside of development work, I also take the responsibility to maintain VMWare server, MSSQL server and build server in this organization.\n\nMy significant contribution to this company is:\n- Implement auto upgrade feature to system.\n- Refine on source code control process for entire team.\n- Implement HL7 for system integration.",
    },
    {
      id: "4",
      company: "MBf holdings bhd.",
      role: "Analyst Programmer",
      startDate: "May 2014",
      endDate: "May 2015",
      description:
        "As an analyst programmer, my main responsibility is to develop in-house medical solution for our own clinic and medical center.\n\nFor this position I will required to cater requirement from requester, and the report to manager for development work. After that I will perform unit testing, once unit testing passed, I will prepare technical documentation for support team for their 2nd round of testing. Once everything passed, we will be having a user engagement session with requester for deliverable demonstration.",
    },
    {
      id: "5",
      company: "NEP Holdings (M) bhd",
      role: "Senior Programmer",
      startDate: "May 2006",
      endDate: "May 2014",
      description:
        "This is the company I grow and learn a lot.\n\nInitially I’m join this company as a junior IT executive for hardware & network infrastructure... After 2 years, which is year 2008, I got an opportunity to switch my role from hardware & network infrastructure to become software developer. I start picking up my development skills (Delphi, MSSQL & Crystal Report) from here.\n\nIn year 2012, company recruited an IT consultant, I learned project management from him. I’m started get involve into project management process.\n\nMy main contribution to this company is:\n- Develop in-house virtual application for regional office and branches (Terminal Services).\n- Assist on develop and implement queue system for sales admin department.\n- Implement staff portal by using Microsoft shared point services.\n- Assist on implement online shopping cart by using OpenCart.\n- Participate on system migration from desktop application to web base CRM Pivotal system.",
    },
  ],
  education: [
    {
      id: "1",
      institution: "Institut Teknologi Pertama",
      degree: "BTEC Higher National Diploma (IT)",
      year: "1999 - 2001",
    },
  ],
  skills: [
    { id: "1", name: "Delphi Programming", category: "backend", level: 100 },
    { id: "2", name: "MSSQL", category: "backend", level: 100 },
    { id: "3", name: "Scrum Methodology", category: "other", level: 100 },
    { id: "4", name: "Crystal Report", category: "tools", level: 80 },
    { id: "5", name: "Python", category: "backend", level: 10 },
    { id: "6", name: "Asp.net MVC", category: "backend", level: 10 },
  ],
  languages: [
    { id: "1", language: "English", proficiency: "Professional (JELA 30/40)" },
  ],
  certifications: [
    { id: "1", name: "Scrum Master Certified (SMC)", year: "2019" },
    { id: "2", name: "Scrum Fundamental Certified (SFC)", year: "2019" },
    { id: "3", name: "Asterisk Essentials Workshop", year: "2013" },
    { id: "4", name: "MS ISA Server 2006 Training", year: "2007" },
    {
      id: "5",
      name: "Administering & Troubleshooting Windows Server 2003",
      year: "2006",
    },
    {
      id: "6",
      name: "Certificate in Information & Communication Technology II",
      year: "2002",
    },
  ],
  contact: {
    email: "c.weihon@outlook.com",
    phone: "+6016-622 5655",
    linkedin: "https://www.linkedin.com/in/chong-wei-hon-976026ab/",
    github: "https://github.com/sky06walker",
  },
};
