import React from 'react';

export default function EditPanel({ sectionId, value, onChange, readOnly, edited }) {
  return (
    <section className="edit-panel">
      <div className="panel-header edit-panel-header">
        <span className="panel-header-tag panel-header-tag-edit">
          {readOnly ? 'FINAL TEXT (APPROVED)' : "DOCTOR'S EDIT"}
        </span>
        {!readOnly && (
          <span className={'edit-status' + (edited ? ' edit-status-dirty' : '')}>
            {edited ? 'EDITED' : 'UNEDITED — AI DRAFT SHOWN'}
          </span>
        )}
      </div>
      <div className="panel-body">
        <textarea
          className="edit-textarea"
          value={value}
          onChange={(e) => onChange(sectionId, e.target.value)}
          disabled={readOnly}
          spellCheck={false}
          rows={14}
          placeholder="No data available — enter manually"
        />
      </div>
    </section>
  );
}
