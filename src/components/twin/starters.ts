// DRAFT - the owner must read and approve this wording before the twin goes live.
//
// Pre-written answers to the starter questions. They are shown instantly in the dialog and
// cost no AI quota, so the twin is useful even when it is resting or switched off. They are
// written from the CV (src/utils/types.ts) and deliberately contain no time-dependent numbers
// ("18 years"); if the CV changes materially, update them here.

export interface Starter {
  id: string;
  question: string;
  answer: string;
}

export const STARTERS: Starter[] = [
  {
    id: 'current-role',
    question: "What's your current role?",
    answer:
      "I'm a Senior Software Engineer at n2n connect bhd, working on a top-ranking trading application. I maintain the existing application and help migrate its Delphi code base to JavaScript.",
  },
  {
    id: 'background',
    question: 'How did you get into software?',
    answer:
      'I started in hardware and network infrastructure in 2006. In 2008 I got the chance to move into software development and picked up Delphi, MSSQL and Crystal Report. I believe continuous learning is what keeps taking me to the next level.',
  },
  {
    id: 'skills',
    question: 'What are your strongest skills?',
    answer:
      "Delphi and MSSQL are my strongest skills, along with Scrum methodology. I also work with Crystal Report, and I have lighter exposure to Python and ASP.NET MVC.",
  },
  {
    id: 'highlights',
    question: 'What have you delivered?',
    answer:
      "At n2n connect I built a trade calculator and an advanced search for trading transactions, and moved the application's connections to JSON. At MBf Holdings I implemented an auto-upgrade feature and certified a POS system against Fiji's latest tax monitoring system. At CompuGroup Medical I implemented HL7 for system integration.",
  },
  {
    id: 'scrum-pm',
    question: 'Do you have Scrum or project management experience?',
    answer:
      "Yes. I was a Project Manager at MBf Holdings Bhd. from 2017 to 2019, handling Retail and POS systems for a client in Fiji. I first worked in Scrum at CompuGroup Medical, and I am a Scrum Master Certified (SMC) and Scrum Fundamental Certified (SFC) since 2019.",
  },
  {
    id: 'certifications',
    question: 'Which certifications do you hold?',
    answer:
      'Scrum Master Certified (SMC) and Scrum Fundamental Certified (SFC), both in 2019. Earlier training includes the Asterisk Essentials Workshop (2013), MS ISA Server 2006 Training (2007), Administering and Troubleshooting Windows Server 2003 (2006), and a Certificate in Information and Communication Technology II (2002).',
  },
  {
    id: 'education',
    question: "What's your education?",
    answer: 'I hold a BTEC Higher National Diploma (IT) from Institut Teknologi Pertama, 1999 to 2001.',
  },
];
