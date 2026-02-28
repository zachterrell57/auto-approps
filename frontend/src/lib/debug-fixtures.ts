/**
 * Dummy data for debug mode — lets you skip document upload, form scraping,
 * and AI mapping so you can work on the answer-sheet UI directly.
 *
 * Only used in development (import.meta.env.DEV).
 */

import type {
  DocChunk,
  FieldMapping,
  FormSchema,
  MappingResult,
  UploadResponse,
} from "./types";

/* ------------------------------------------------------------------ */
/*  Document chunks (simulates a parsed RFP response document)        */
/* ------------------------------------------------------------------ */

const chunks: DocChunk[] = [
  // — Section 1: Applicant Information —
  {
    text: "Applicant Information",
    source_location: "Heading 1",
    chunk_type: "heading",
    heading_context: "Applicant Information",
    heading_level: 1,
    index: 0,
  },
  {
    text: "Full Name: Jane Doe",
    source_location: "Section 'Applicant Information' > Paragraph 1",
    chunk_type: "paragraph",
    heading_context: "Applicant Information",
    heading_level: 0,
    index: 1,
  },
  {
    text: "Email: jane.doe@acmecorp.com",
    source_location: "Section 'Applicant Information' > Paragraph 2",
    chunk_type: "paragraph",
    heading_context: "Applicant Information",
    heading_level: 0,
    index: 2,
  },
  {
    text: "Organization: Acme Corporation",
    source_location: "Section 'Applicant Information' > Paragraph 3",
    chunk_type: "paragraph",
    heading_context: "Applicant Information",
    heading_level: 0,
    index: 3,
  },
  {
    text: "Phone: (555) 123-4567",
    source_location: "Section 'Applicant Information' > Paragraph 4",
    chunk_type: "paragraph",
    heading_context: "Applicant Information",
    heading_level: 0,
    index: 4,
  },
  {
    text: "Title: Vice President, Technology Solutions",
    source_location: "Section 'Applicant Information' > Paragraph 5",
    chunk_type: "paragraph",
    heading_context: "Applicant Information",
    heading_level: 0,
    index: 5,
  },
  {
    text: "Mailing Address: 1400 Innovation Drive, Suite 300, Austin, TX 78701",
    source_location: "Section 'Applicant Information' > Paragraph 6",
    chunk_type: "paragraph",
    heading_context: "Applicant Information",
    heading_level: 0,
    index: 6,
  },

  // — Section 2: Executive Summary —
  {
    text: "Executive Summary",
    source_location: "Heading 2",
    chunk_type: "heading",
    heading_context: "Executive Summary",
    heading_level: 1,
    index: 7,
  },
  {
    text: "Acme Corporation is pleased to submit this proposal in response to the 2026 Technology Modernization Grant Program. Our organization has a 15-year track record of delivering innovative technology solutions for mid-market enterprises across the Southwest region.",
    source_location: "Section 'Executive Summary' > Paragraph 1",
    chunk_type: "paragraph",
    heading_context: "Executive Summary",
    heading_level: 0,
    index: 8,
  },
  {
    text: "This proposal outlines our plan to implement a cloud-based document management system that will centralize over 2.3 million records currently distributed across seven legacy systems. The initiative will directly benefit 140 employees across four departments and is projected to reduce document retrieval time by 75%.",
    source_location: "Section 'Executive Summary' > Paragraph 2",
    chunk_type: "paragraph",
    heading_context: "Executive Summary",
    heading_level: 0,
    index: 9,
  },
  {
    text: "We are requesting $250,000 in grant funding to cover software licensing, infrastructure provisioning, data migration, custom integration development, and staff training over a 12-month implementation period beginning Q3 2026.",
    source_location: "Section 'Executive Summary' > Paragraph 3",
    chunk_type: "paragraph",
    heading_context: "Executive Summary",
    heading_level: 0,
    index: 10,
  },

  // — Section 3: Project Details —
  {
    text: "Project Details",
    source_location: "Heading 3",
    chunk_type: "heading",
    heading_context: "Project Details",
    heading_level: 1,
    index: 11,
  },
  {
    text: "Acme Corporation proposes to implement a cloud-based document management system to streamline internal workflows and improve cross-departmental collaboration. The project will run for 12 months beginning Q3 2026.",
    source_location: "Section 'Project Details' > Paragraph 1",
    chunk_type: "paragraph",
    heading_context: "Project Details",
    heading_level: 0,
    index: 12,
  },
  {
    text: "The system will replace our current patchwork of shared network drives, email-based approvals, and a partially deployed SharePoint 2016 instance that has reached end-of-life. Employees currently spend an average of 22 minutes per document search, and version-control errors account for roughly 8% of compliance review findings.",
    source_location: "Section 'Project Details' > Paragraph 2",
    chunk_type: "paragraph",
    heading_context: "Project Details",
    heading_level: 0,
    index: 13,
  },
  {
    text: "Key deliverables include: (1) a centralized cloud repository with role-based access controls, (2) automated document lifecycle workflows including review, approval, and archival, (3) full-text search with metadata tagging, (4) integration with existing ERP and CRM systems via REST APIs, and (5) a self-service reporting dashboard for compliance audits.",
    source_location: "Section 'Project Details' > Paragraph 3",
    chunk_type: "paragraph",
    heading_context: "Project Details",
    heading_level: 0,
    index: 14,
  },
  {
    text: "The platform will be hosted on AWS GovCloud to meet FedRAMP Moderate baseline requirements. All data at rest will be encrypted with AES-256, and data in transit will use TLS 1.3. Multi-factor authentication will be enforced for all user accounts.",
    source_location: "Section 'Project Details' > Paragraph 4",
    chunk_type: "paragraph",
    heading_context: "Project Details",
    heading_level: 0,
    index: 15,
  },

  // — Section 4: Technical Approach —
  {
    text: "Technical Approach",
    source_location: "Heading 4",
    chunk_type: "heading",
    heading_context: "Technical Approach",
    heading_level: 1,
    index: 16,
  },
  {
    text: "Our technical approach follows an Agile methodology with two-week sprints, supported by continuous integration and continuous deployment (CI/CD) pipelines. The architecture is based on a microservices pattern deployed in Docker containers orchestrated by Amazon ECS.",
    source_location: "Section 'Technical Approach' > Paragraph 1",
    chunk_type: "paragraph",
    heading_context: "Technical Approach",
    heading_level: 0,
    index: 17,
  },
  {
    text: "The document ingestion pipeline will leverage Apache Tika for content extraction, Amazon Textract for OCR processing of scanned documents, and a custom NLP classifier built on spaCy to auto-tag documents by category, sensitivity level, and retention policy.",
    source_location: "Section 'Technical Approach' > Paragraph 2",
    chunk_type: "paragraph",
    heading_context: "Technical Approach",
    heading_level: 0,
    index: 18,
  },
  {
    text: "The front-end application will be built with React 19 and TypeScript, providing a responsive interface that works across desktop and tablet form factors. We will implement progressive web app (PWA) capabilities to support limited offline access for field personnel.",
    source_location: "Section 'Technical Approach' > Paragraph 3",
    chunk_type: "paragraph",
    heading_context: "Technical Approach",
    heading_level: 0,
    index: 19,
  },
  {
    text: "| Technology | Purpose | License |\n| AWS S3 / Glacier | Document storage & archival | Commercial |\n| PostgreSQL 16 | Metadata & search index | Open Source |\n| Elasticsearch 8 | Full-text search engine | Open Source |\n| Apache Kafka | Event streaming | Open Source |\n| Keycloak | Identity & access management | Open Source |",
    source_location: "Section 'Technical Approach' > Table 1",
    chunk_type: "table_row",
    heading_context: "Technical Approach",
    heading_level: 0,
    index: 20,
  },

  // — Section 5: Budget and Timeline —
  {
    text: "Budget and Timeline",
    source_location: "Heading 5",
    chunk_type: "heading",
    heading_context: "Budget and Timeline",
    heading_level: 1,
    index: 21,
  },
  {
    text: "Total estimated budget: $250,000. Phase 1 (months 1-4): requirements & design. Phase 2 (months 5-9): development & testing. Phase 3 (months 10-12): deployment & training.",
    source_location: "Section 'Budget and Timeline' > Paragraph 1",
    chunk_type: "paragraph",
    heading_context: "Budget and Timeline",
    heading_level: 0,
    index: 22,
  },
  {
    text: "| Budget Category | Amount | Percentage |\n| Software Licensing | $65,000 | 26% |\n| Cloud Infrastructure (12 mo.) | $48,000 | 19% |\n| Data Migration Services | $35,000 | 14% |\n| Custom Development | $52,000 | 21% |\n| Staff Training & Change Mgmt | $28,000 | 11% |\n| Project Management & QA | $22,000 | 9% |",
    source_location: "Section 'Budget and Timeline' > Table 1",
    chunk_type: "table_row",
    heading_context: "Budget and Timeline",
    heading_level: 0,
    index: 23,
  },
  {
    text: "Phase 1 focuses on stakeholder interviews, requirements documentation, solution architecture design, and vendor evaluation for the core DMS platform. A proof-of-concept environment will be delivered by the end of month 3 for stakeholder review.",
    source_location: "Section 'Budget and Timeline' > Paragraph 2",
    chunk_type: "paragraph",
    heading_context: "Budget and Timeline",
    heading_level: 0,
    index: 24,
  },
  {
    text: "Phase 2 covers iterative development of the core platform, data migration from legacy systems, integration development with the ERP and CRM, and comprehensive testing including load testing, security penetration testing, and user acceptance testing (UAT).",
    source_location: "Section 'Budget and Timeline' > Paragraph 3",
    chunk_type: "paragraph",
    heading_context: "Budget and Timeline",
    heading_level: 0,
    index: 25,
  },
  {
    text: "Phase 3 includes production deployment with a staged rollout across departments, administrator and end-user training sessions, documentation of operational procedures, and a 30-day hypercare support period to address post-launch issues.",
    source_location: "Section 'Budget and Timeline' > Paragraph 4",
    chunk_type: "paragraph",
    heading_context: "Budget and Timeline",
    heading_level: 0,
    index: 26,
  },

  // — Section 6: Qualifications & Experience —
  {
    text: "Qualifications and Experience",
    source_location: "Heading 6",
    chunk_type: "heading",
    heading_context: "Qualifications and Experience",
    heading_level: 1,
    index: 27,
  },
  {
    text: "Acme Corporation was founded in 2011 and has grown to 140 full-time employees across offices in Austin, TX and Denver, CO. We hold ISO 27001 certification and have maintained SOC 2 Type II compliance since 2019.",
    source_location: "Section 'Qualifications and Experience' > Paragraph 1",
    chunk_type: "paragraph",
    heading_context: "Qualifications and Experience",
    heading_level: 0,
    index: 28,
  },
  {
    text: "Over the past five years, we have successfully completed 12 enterprise document management implementations for clients in financial services, healthcare, and government sectors, ranging in scope from $80,000 to $1.2 million.",
    source_location: "Section 'Qualifications and Experience' > Paragraph 2",
    chunk_type: "paragraph",
    heading_context: "Qualifications and Experience",
    heading_level: 0,
    index: 29,
  },
  {
    text: "| Role | Name | Years of Experience |\n| Project Lead | Jane Doe | 12 |\n| Technical Architect | John Smith | 9 |\n| Senior Developer | Maria Garcia | 7 |\n| Data Migration Lead | David Chen | 11 |\n| QA Lead | Sarah Johnson | 6 |",
    source_location: "Section 'Qualifications and Experience' > Table 1",
    chunk_type: "table_row",
    heading_context: "Qualifications and Experience",
    heading_level: 0,
    index: 30,
  },
  {
    text: "Jane Doe, the proposed Project Lead, has managed document management initiatives for three Fortune 500 companies and holds PMP, AWS Solutions Architect, and CISM certifications. She will dedicate 80% of her time to this project.",
    source_location: "Section 'Qualifications and Experience' > Paragraph 3",
    chunk_type: "paragraph",
    heading_context: "Qualifications and Experience",
    heading_level: 0,
    index: 31,
  },
  {
    text: "John Smith, our Technical Architect, previously led the migration of 4.5 million records from a legacy Documentum instance to a cloud-native platform for a regional healthcare network. He holds certifications in AWS, Azure, and Kubernetes.",
    source_location: "Section 'Qualifications and Experience' > Paragraph 4",
    chunk_type: "paragraph",
    heading_context: "Qualifications and Experience",
    heading_level: 0,
    index: 32,
  },

  // — Section 7: Risk Management —
  {
    text: "Risk Management",
    source_location: "Heading 7",
    chunk_type: "heading",
    heading_context: "Risk Management",
    heading_level: 1,
    index: 33,
  },
  {
    text: "We have identified the following key risks and corresponding mitigation strategies for this project. A formal risk register will be maintained and reviewed bi-weekly during project stand-ups.",
    source_location: "Section 'Risk Management' > Paragraph 1",
    chunk_type: "paragraph",
    heading_context: "Risk Management",
    heading_level: 0,
    index: 34,
  },
  {
    text: "| Risk | Likelihood | Impact | Mitigation |\n| Data migration data loss | Low | High | Checksummed transfers with rollback capability |\n| Scope creep from stakeholders | Medium | Medium | Change control board with formal CR process |\n| Vendor platform instability | Low | High | Multi-region deployment with automated failover |\n| Staff resistance to new system | Medium | Medium | Early engagement, training champions program |\n| Integration failures with ERP | Medium | High | API contract testing in CI pipeline |",
    source_location: "Section 'Risk Management' > Table 1",
    chunk_type: "table_row",
    heading_context: "Risk Management",
    heading_level: 0,
    index: 35,
  },
  {
    text: "In the event that a critical risk materializes, escalation will follow our standard RACI matrix. The project sponsor (CTO, Robert Williams) has committed executive oversight with weekly status briefings and authority to approve contingency budget of up to 10% ($25,000).",
    source_location: "Section 'Risk Management' > Paragraph 2",
    chunk_type: "paragraph",
    heading_context: "Risk Management",
    heading_level: 0,
    index: 36,
  },

  // — Section 8: References —
  {
    text: "References",
    source_location: "Heading 8",
    chunk_type: "heading",
    heading_context: "References",
    heading_level: 1,
    index: 37,
  },
  {
    text: "Southwest Regional Medical Center — Completed a 2.1 million record migration from Documentum to AWS-based DMS in 2024. Contact: Laura Mitchell, CIO, laura.mitchell@srmc-example.org, (555) 987-6543.",
    source_location: "Section 'References' > Paragraph 1",
    chunk_type: "paragraph",
    heading_context: "References",
    heading_level: 0,
    index: 38,
  },
  {
    text: "First National Credit Union — Designed and deployed a compliance document workflow system handling 15,000 documents per month with 99.97% uptime over 18 months. Contact: Thomas Park, VP Operations, tpark@fncu-example.com, (555) 234-5678.",
    source_location: "Section 'References' > Paragraph 2",
    chunk_type: "paragraph",
    heading_context: "References",
    heading_level: 0,
    index: 39,
  },
  {
    text: "City of Cedar Falls, IA — Built a public records request portal integrated with the city's existing Laserfiche system, reducing average request fulfillment time from 14 days to 3 days. Contact: Angela Reyes, City Clerk, areyes@cedarfalls-example.gov, (555) 345-6789.",
    source_location: "Section 'References' > Paragraph 3",
    chunk_type: "paragraph",
    heading_context: "References",
    heading_level: 0,
    index: 40,
  },

  // — Section 9: Compliance & Certifications —
  {
    text: "Compliance and Certifications",
    source_location: "Heading 9",
    chunk_type: "heading",
    heading_context: "Compliance and Certifications",
    heading_level: 1,
    index: 41,
  },
  {
    text: "Acme Corporation maintains the following active certifications and compliance attestations: ISO 27001:2022 (Information Security Management), SOC 2 Type II (annually renewed, most recent report dated January 2026), and FedRAMP Ready designation for our managed cloud services offering.",
    source_location: "Section 'Compliance and Certifications' > Paragraph 1",
    chunk_type: "paragraph",
    heading_context: "Compliance and Certifications",
    heading_level: 0,
    index: 42,
  },
  {
    text: "All development staff complete annual OWASP Top 10 security training and quarterly secure code review workshops. Our SDLC incorporates automated SAST/DAST scanning via Snyk and OWASP ZAP, with mandatory remediation of critical and high findings before production deployment.",
    source_location: "Section 'Compliance and Certifications' > Paragraph 2",
    chunk_type: "paragraph",
    heading_context: "Compliance and Certifications",
    heading_level: 0,
    index: 43,
  },
  {
    text: "For this project, we will comply with all applicable state and federal data privacy regulations including HIPAA (where health records are involved), FERPA, and the Texas Data Privacy and Security Act (TDPSA) effective July 2024.",
    source_location: "Section 'Compliance and Certifications' > Paragraph 3",
    chunk_type: "paragraph",
    heading_context: "Compliance and Certifications",
    heading_level: 0,
    index: 44,
  },

  // — Section 10: Sustainability & Long-Term Support —
  {
    text: "Sustainability and Long-Term Support",
    source_location: "Heading 10",
    chunk_type: "heading",
    heading_context: "Sustainability and Long-Term Support",
    heading_level: 1,
    index: 45,
  },
  {
    text: "Post-implementation, Acme Corporation offers tiered support plans ranging from basic (business-hours email support, 8-hour SLA) to premium (24/7 phone and chat support, 1-hour SLA for critical issues). We recommend the standard tier ($3,200/month) for the first 12 months following go-live.",
    source_location: "Section 'Sustainability and Long-Term Support' > Paragraph 1",
    chunk_type: "paragraph",
    heading_context: "Sustainability and Long-Term Support",
    heading_level: 0,
    index: 46,
  },
  {
    text: "Knowledge transfer is a core component of our delivery model. By the end of Phase 3, the client's IT team will receive comprehensive admin training, runbook documentation, and access to a recorded training library. We target a self-sufficiency score of 90% by month 14.",
    source_location: "Section 'Sustainability and Long-Term Support' > Paragraph 2",
    chunk_type: "paragraph",
    heading_context: "Sustainability and Long-Term Support",
    heading_level: 0,
    index: 47,
  },
  {
    text: "The proposed platform is designed for horizontal scalability. Based on current growth projections, the architecture can support up to 10 million documents and 500 concurrent users without requiring infrastructure changes beyond routine autoscaling.",
    source_location: "Section 'Sustainability and Long-Term Support' > Paragraph 3",
    chunk_type: "paragraph",
    heading_context: "Sustainability and Long-Term Support",
    heading_level: 0,
    index: 48,
  },
  {
    text: "Annual platform updates will be delivered through a managed upgrade process with staging environment validation, regression testing, and a documented rollback procedure. Major version upgrades are included in the support plan at no additional cost.",
    source_location: "Section 'Sustainability and Long-Term Support' > Paragraph 4",
    chunk_type: "paragraph",
    heading_context: "Sustainability and Long-Term Support",
    heading_level: 0,
    index: 49,
  },
];

/* ------------------------------------------------------------------ */
/*  Form schema (simulates a scraped Google Form questionnaire)       */
/* ------------------------------------------------------------------ */

export const DEBUG_FORM_SCHEMA: FormSchema = {
  title: "2026 Technology Grant Application",
  description:
    "Please complete this application form for the annual technology modernization grant program.",
  fields: [
    {
      field_id: "entry.100000001",
      label: "Full Name",
      field_type: "short_text",
      required: true,
      options: [],
      page_index: 0,
    },
    {
      field_id: "entry.100000002",
      label: "Email Address",
      field_type: "short_text",
      required: true,
      options: [],
      page_index: 0,
    },
    {
      field_id: "entry.100000003",
      label: "Organization Name",
      field_type: "short_text",
      required: true,
      options: [],
      page_index: 0,
    },
    {
      field_id: "entry.100000004",
      label: "Phone Number",
      field_type: "short_text",
      required: false,
      options: [],
      page_index: 0,
    },
    {
      field_id: "entry.100000005",
      label: "Organization Size",
      field_type: "radio",
      required: true,
      options: ["1-10 employees", "11-50 employees", "51-200 employees", "201+ employees"],
      page_index: 0,
    },
    {
      field_id: "entry.100000006",
      label: "Project Title",
      field_type: "short_text",
      required: true,
      options: [],
      page_index: 1,
    },
    {
      field_id: "entry.100000007",
      label: "Project Description",
      field_type: "long_text",
      required: true,
      options: [],
      page_index: 1,
    },
    {
      field_id: "entry.100000008",
      label: "Requested Budget",
      field_type: "dropdown",
      required: true,
      options: [
        "Under $50,000",
        "$50,000 - $100,000",
        "$100,001 - $250,000",
        "$250,001 - $500,000",
        "Over $500,000",
      ],
      page_index: 1,
    },
    {
      field_id: "entry.100000009",
      label: "Project Timeline",
      field_type: "radio",
      required: true,
      options: ["3 months", "6 months", "12 months", "18+ months"],
      page_index: 1,
    },
    {
      field_id: "entry.100000010",
      label: "Technology Areas (select all that apply)",
      field_type: "checkbox",
      required: false,
      options: [
        "Cloud Infrastructure",
        "Data Analytics",
        "Cybersecurity",
        "AI / Machine Learning",
        "Document Management",
      ],
      page_index: 1,
    },
    {
      field_id: "entry.100000011",
      label: "Expected Start Date",
      field_type: "date",
      required: false,
      options: [],
      page_index: 2,
    },
    {
      field_id: "entry.100000012",
      label: "How did you hear about this grant?",
      field_type: "radio",
      required: false,
      options: ["Website", "Email Newsletter", "Colleague", "Social Media", "Other"],
      page_index: 2,
    },
    {
      field_id: "entry.100000013",
      label: "Additional Comments",
      field_type: "long_text",
      required: false,
      options: [],
      page_index: 2,
    },
  ],
  page_count: 3,
  url: "https://docs.google.com/forms/d/e/DEBUG_FORM/viewform",
  provider: "google",
  scrape_warnings: [],
};

/* ------------------------------------------------------------------ */
/*  Mapping result (simulates Claude AI field mapping output)         */
/* ------------------------------------------------------------------ */

const mappings: FieldMapping[] = [
  {
    field_id: "entry.100000001",
    field_label: "Full Name",
    proposed_answer: "Jane Doe",
    source_citation: "Section 'Applicant Information' > Paragraph 1",
    confidence: "high",
    reasoning: "Explicit mention of full name in applicant section.",

    source_chunks: [chunks[1]],
  },
  {
    field_id: "entry.100000002",
    field_label: "Email Address",
    proposed_answer: "jane.doe@acmecorp.com",
    source_citation: "Section 'Applicant Information' > Paragraph 2",
    confidence: "high",
    reasoning: "Email address listed directly in applicant info.",

    source_chunks: [chunks[2]],
  },
  {
    field_id: "entry.100000003",
    field_label: "Organization Name",
    proposed_answer: "Acme Corporation",
    source_citation: "Section 'Applicant Information' > Paragraph 3",
    confidence: "high",
    reasoning: "Organization explicitly stated in applicant section.",

    source_chunks: [chunks[3]],
  },
  {
    field_id: "entry.100000004",
    field_label: "Phone Number",
    proposed_answer: "(555) 123-4567",
    source_citation: "Section 'Applicant Information' > Paragraph 4",
    confidence: "high",
    reasoning: "Phone number directly listed.",

    source_chunks: [chunks[4]],
  },
  {
    field_id: "entry.100000005",
    field_label: "Organization Size",
    proposed_answer: "51-200 employees",
    source_citation: "Section 'Qualifications and Experience' > Paragraph 1",
    confidence: "high",
    reasoning:
      "Document states Acme Corporation has 140 full-time employees, which falls in the 51-200 range.",

    source_chunks: [chunks[28], chunks[30]],
  },
  {
    field_id: "entry.100000006",
    field_label: "Project Title",
    proposed_answer: "Cloud-Based Document Management System",
    source_citation: "Section 'Project Details' > Paragraph 1",
    confidence: "high",
    reasoning: "Project name derived from the project description heading and opening paragraph.",

    source_chunks: [chunks[12]],
  },
  {
    field_id: "entry.100000007",
    field_label: "Project Description",
    proposed_answer:
      "Acme Corporation proposes to implement a cloud-based document management system to centralize over 2.3 million records currently distributed across seven legacy systems. The system will provide role-based access controls, automated document lifecycle workflows, full-text search with metadata tagging, ERP/CRM integration, and a compliance reporting dashboard. The initiative will benefit 140 employees across four departments and is projected to reduce document retrieval time by 75%.",
    source_citation: "Section 'Executive Summary' > Paragraph 2, Section 'Project Details' > Paragraph 3",
    confidence: "high",
    reasoning: "Comprehensive project description synthesized from Executive Summary and Project Details sections.",

    source_chunks: [chunks[9], chunks[12], chunks[14]],
  },
  {
    field_id: "entry.100000008",
    field_label: "Requested Budget",
    proposed_answer: "$100,001 - $250,000",
    source_citation: "Section 'Budget and Timeline' > Paragraph 1",
    confidence: "high",
    reasoning: "Total estimated budget is $250,000 which falls in this range.",

    source_chunks: [chunks[22], chunks[23]],
  },
  {
    field_id: "entry.100000009",
    field_label: "Project Timeline",
    proposed_answer: "12 months",
    source_citation: "Section 'Project Details' > Paragraph 1",
    confidence: "high",
    reasoning: "Document states the project will run for 12 months.",

    source_chunks: [chunks[12], chunks[22]],
  },
  {
    field_id: "entry.100000010",
    field_label: "Technology Areas (select all that apply)",
    proposed_answer: "Cloud Infrastructure, Document Management",
    source_citation: "Section 'Project Details' > Paragraph 4, Section 'Technical Approach' > Paragraph 1",
    confidence: "medium",
    reasoning:
      "Project involves cloud-based infrastructure (AWS GovCloud hosting) and document management based on description. Data Analytics could also apply given the reporting dashboard, but it is not the primary focus.",

    source_chunks: [chunks[15], chunks[17], chunks[14]],
  },
  {
    field_id: "entry.100000011",
    field_label: "Expected Start Date",
    proposed_answer: "2026-07-01",
    source_citation: "Section 'Executive Summary' > Paragraph 3",
    confidence: "medium",
    reasoning: "Document mentions Q3 2026 start; July 1 is the beginning of Q3.",

    source_chunks: [chunks[10], chunks[12]],
  },
  {
    field_id: "entry.100000012",
    field_label: "How did you hear about this grant?",
    proposed_answer: "",
    source_citation: "",
    confidence: "low",
    reasoning: "No information about referral source found in the document.",

    source_chunks: [],
  },
  {
    field_id: "entry.100000013",
    field_label: "Additional Comments",
    proposed_answer: "",
    source_citation: "",
    confidence: "low",
    reasoning: "No additional comments found in the source document.",

    source_chunks: [],
  },
];

/** URL for the static debug .docx served from public/ by Vite dev server. */
export const DEBUG_DOC_BLOB_URL = "/debug-rfp-response.docx";

export const DEBUG_UPLOAD_RESPONSE: UploadResponse = {
  filename: "debug_rfp_response.docx",
  chunk_count: chunks.length,
  preview: chunks.map((c) => c.text).join("\n"),
};

export const DEBUG_MAPPING_RESULT: MappingResult = {
  mappings,
  unmapped_fields: ["entry.100000012"],
  doc_chunks: chunks,
};
