import React from 'react';

export default function DraftPanel({
  title,
  text,
  onRegenerate,
  regenLoading,
  regenError,
  draftLoading,
  sourceNeedsVerification,
  readOnly,
}) {
  if (readOnly) {
    return (
      <section className="draft-panel draft-panel-readonly">
        <div className="panel-header">
          <span className="panel-header-title">{title}</span>
        </div>
        <div className="panel-plain">Approved summary loaded — AI draft panel disabled.</div>
      </section>
    );
  }

  const empty = !text || !text.trim();

  return (
    <section className="draft-panel">
      <div className="panel-header draft-panel-header">
        <span className="panel-header-title">{title}</span>
        <span className="panel-header-tag">AI GENERATED DRAFT</span>
        <button
          type="button"
          className="btn btn-small"
          onClick={onRegenerate}
          disabled={regenLoading || draftLoading}
        >
          {regenLoading ? 'Regenerating…' : 'Regenerate Section'}
        </button>
      </div>
      {draftLoading ? (
        <div className="panel-body panel-plain">Generating AI draft from the loaded clinical data…</div>
      ) : regenLoading ? (
        <div className="panel-body panel-plain">Generating draft for this section…</div>
      ) : regenError ? (
        <div className="panel-body panel-plain panel-plain-error">
          Section data unavailable — {regenError}
          <button type="button" className="btn btn-small" onClick={onRegenerate}>
            Retry
          </button>
        </div>
      ) : empty ? (
        <div className="panel-body panel-plain">No data available — enter manually</div>
      ) : (
        <div className="panel-body draft-text">
          {sourceNeedsVerification && (
            <div className="source-verification-note">
              Some facts came from clinical notes. Review the Source data panel before approval.
            </div>
          )}
          <pre className="draft-pre">{text}</pre>
        </div>
      )}
    </section>
  );
}
