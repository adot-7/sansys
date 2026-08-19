import React from 'react';

export default function ApproveBar({
  approvedBy,
  onApprovedByChange,
  onApprove,
  approving,
  approveError,
  missingRequired,
  approveMissing,
  readOnly,
  approvedInfo,
}) {
  const missing = missingRequired.length ? missingRequired : approveMissing;
  const disabled = readOnly || approving || !approvedBy.trim() || missing.length > 0;

  return (
    <div className="approve-bar">
      {readOnly ? (
        <div className="approve-approved">
          <span className="approve-approved-text">
            APPROVED {approvedInfo && approvedInfo.approvedAt} BY{' '}
            {approvedInfo && (approvedInfo.approvedBy || '—')} — SUMMARY LOCKED
          </span>
        </div>
      ) : (
        <>
          <label className="field field-inline">
            <span className="field-label">APPROVED BY</span>
            <input
              type="text"
              className="input"
              value={approvedBy}
              onChange={(e) => onApprovedByChange(e.target.value)}
              placeholder="Dr. name"
            />
          </label>
          <button type="button" className="btn btn-primary" onClick={onApprove} disabled={disabled}>
            {approving ? 'Approving…' : 'Approve Summary'}
          </button>
          {missing.length > 0 && (
            <span className="approve-missing">
              REQUIRED SECTIONS EMPTY: {missing.join(', ')}
            </span>
          )}
          {approveError && <span className="approve-error">{approveError}</span>}
        </>
      )}
    </div>
  );
}
