import React from 'react';
import { parsePrintContent } from './printFormat.js';

function PrintSectionContent({ text }) {
  const blocks = parsePrintContent(text);
  if (!blocks.length) return <p className="print-empty">—</p>;
  return blocks.map((block, index) => block.type === 'list'
    ? <ul className="print-list" key={`list-${index}`}>{block.items.map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}</ul>
    : <p className="print-paragraph" key={`paragraph-${index}`}>{block.text}</p>);
}

export default function PrintSummary({ patient, approved, sections }) {
  const demographics = patient?.demographics || {};
  const episode = patient?.episode || {};
  const name = [demographics.firstName, demographics.lastName].filter(Boolean).join(' ') || '—';
  return <div className="print-summary">
    <header className="print-document-header">
      <div className="print-document-kicker">INPATIENT CARE</div>
      <h1>Discharge Summary</h1>
      <div className="print-document-status">APPROVED CLINICAL DOCUMENT</div>
    </header>
    <section className="print-identity" aria-label="Patient and episode information">
      <div className="print-identity-name">{name}</div>
      <dl className="print-identity-grid">
        <div><dt>Patient ID / UHID</dt><dd>{demographics.uhid || patient?.dfn || '—'}</dd></div>
        <div><dt>IP number</dt><dd>{demographics.ipNo || '—'}</dd></div>
        <div><dt>Age / sex</dt><dd>{[demographics.age, demographics.sex].filter(Boolean).join(' / ') || '—'}</dd></div>
        <div><dt>Date of birth</dt><dd>{demographics.dob || '—'}</dd></div>
        <div><dt>Episode</dt><dd>{episode.label || approved?.episodeId || '—'}</dd></div>
        <div><dt>Admission</dt><dd>{demographics.admitDate || episode.startDate || '—'}</dd></div>
        <div><dt>Discharge</dt><dd>{demographics.dischargeDate || '—'}</dd></div>
        <div><dt>Specialty</dt><dd>{approved?.specialty || '—'}</dd></div>
      </dl>
    </section>
    <div className="print-approval-meta">
      <span><strong>Approved by:</strong> {approved?.approvedBy || '—'}</span>
      <span><strong>Approved:</strong> {approved?.approvedAt || '—'}</span>
    </div>
    <main className="print-sections">
      {sections.map((section) => <section className="print-section" key={section.id}>
        <h2>{section.title}</h2>
        <PrintSectionContent text={approved?.sections?.[section.id] || ''} />
      </section>)}
    </main>
    <footer className="print-document-footer">Confidential patient health information · Handle according to applicable privacy requirements</footer>
  </div>;
}
