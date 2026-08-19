import React from 'react';

export default function SectionNav({ sections, activeId, onSelect, requiredIds, missingIds, loading, readOnly }) {
  return (
    <nav className="section-nav" aria-label="Summary sections">
      <div className="section-nav-header">SECTIONS</div>
      {loading && sections.length === 0 && (
        <div className="section-nav-loading">Loading…</div>
      )}
      {!loading && sections.length === 0 && (
        <div className="section-nav-loading">No sections</div>
      )}
      <ol className="section-nav-list">
        {sections.map((s, i) => {
          const isMissing = missingIds.includes(s.id);
          const isRequired = requiredIds.includes(s.id);
          return (
            <li key={s.id}>
              <button
                type="button"
                className={
                  'section-nav-item' + (s.id === activeId ? ' section-nav-item-active' : '')
                }
                onClick={() => onSelect(s.id)}
                aria-current={s.id === activeId ? 'true' : undefined}
              >
                <span className="section-nav-num">{String(i + 1).padStart(2, '0')}</span>
                <span className="section-nav-title">{s.title}</span>
                {readOnly ? null : isMissing ? (
                  <span className="section-nav-flag section-nav-flag-missing" title="Required — not filled in">
                    REQ
                  </span>
                ) : isRequired ? (
                  <span className="section-nav-flag" title="Required manual section">
                    REQ
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ol>
      {readOnly && <div className="section-nav-footer">APPROVED — READ ONLY</div>}
    </nav>
  );
}
