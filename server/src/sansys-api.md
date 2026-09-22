# Sansys test API — actual endpoint shapes

This is the reference for the **external** Sansys test API (`SANSYS_BASE_URL`,
default `http://182.70.249.137:5050`). It is read by exactly one module:
`server/src/dataAccess.js`. When the API changes, update **this file first**,
then the field mappers in `dataAccess.js` and the test fixture in
`server/test/fixtures/patient.js`. The normalized internal contract (what the
rest of the app sees) lives in `server/src/contracts.md` and must not be touched
for API drifts.

General rules:

- No authentication on any endpoint. Read-only: we never call anything that
  writes.
- Patient identifiers are inconsistent across endpoints. Two distinct systems
  appear: `dfn` (e.g. `PAT123456`) and `patientIen`. Visit/admission ids also
  vary (`visit_id`, `admissionId`, `admissionIen`). They are **not**
  interchangeable — each endpoint documents which one it wants.
- Every live response is wrapped as `{ success, data }` with lists nested one
  level down (see each shape). Allergies puts `data` at the top level with a
  sibling `status`.
- The normalization layer is deliberately tolerant: a field that goes missing
  normalizes to `""` / empty array rather than crashing. A drifted shape shows
  up as empty sections in the UI — if that happens, diff against this file.

## Provided contract vs observed payload

The payload examples originally provided for integration were not the exact
responses returned by the live test server. The application therefore keeps a
normalization layer in `dataAccess.js`; the frontend never consumes these raw
payloads directly.

| Area | Provided/expected shape | Observed live shape | Adaptation |
| --- | --- | --- | --- |
| Response wrapper | Lists were expected directly or with consistent nesting | Most responses are `{ success, data: { <list>: [...] } }` | `listOf()` accepts both direct and nested lists |
| Patient identity | One patient identifier was expected everywhere | Endpoints mix `dfn`, `patientIen`, `visit_id`, `admissionId`, and `admissionIen` | The adapter uses the endpoint-specific identifier; they are not interchangeable |
| Demographics | Normal names such as `firstName`, `lastName`, `uhid`, and `ipNo` | Raw names such as `lfname`, `llname`, `cpPID`, and `cpIPNo` | Mapped into the normalized demographics object |
| Clinical notes | Full note content was expected | The list returns metadata; detail content and `patient_objects` may be empty | Draft requests load note details; structured note facts are reconciled into canonical collections with provenance |
| Vitals | A populated vitals list was expected on the first request | First response can contain empty `vitals` plus an `admissions` list | The adapter retries with the returned admission ID |
| Vital measurements | Measurements may be a list of readings | Measurements are an object keyed by vital name; abnormality is indicated by `is_abnormal` (older payloads used `bgColor`) | Keys are converted to normalized measurement records and empty values are dropped |
| Lab status | Status was expected as a string | Lab status is an object such as `{ name: "COMPLETED" }` | The nested status name is extracted |
| Radiology status | Status was expected as an object | Radiology status is a string | The string is retained |
| Allergies | Allergies were expected under a nested list property | `data` is the array itself and `status` is a top-level sibling | Both the status and item array are normalized |
| Complaints/allergies | `dfn` was expected as the path identifier | These endpoints require `patientIen` in the path, plus `admissionIen` for complaints | The adapter uses the endpoint-specific patient/admission identifiers |
| Medications | `dfn` was expected in the request body | `dfn` is required both in the query string and body | Both locations are sent |
| Dates | Valid date strings were expected | Some live responses contain literal `Invalid date` | Invalid placeholders are normalized to blank strings |

The stable object produced after these adaptations is documented in
`contracts.md`. If the upstream payload changes again, update this table and
the corresponding mapper in `dataAccess.js` before changing frontend code.

## Episodes and admission filtering

The live API exposes inpatient episodes through `visits.ipVisits` in several
responses, including medication, diagnosis, lab, and problem responses. A live
example is:

```json
{
  "default_visit": "1-9013",
  "visits": {
    "ipVisits": [
      { "id": "1-9013", "name": "23 JUL 2026 16:11 - MAX-SMART ICU-A" },
      { "id": "1-1", "name": "25 MAY 2025 16:00 - MAX-SMART ICU-A" }
    ]
  }
}
```

The full ID (`1-9013`) is used as `visit_id` for medications, labs,
radiology, problems, and diagnoses. The numeric suffix (`9013`) is used as
`admissionId` for vitals and `admissionIen` for complaints. The patient DFN is
used as `patientIen` by the live complaints/allergies endpoints.

The notes list accepts `visit_id` in the request body, as well as `date_from`
and `date_to`. The adapter sends the full IP visit ID and retains the derived
date window as a secondary safeguard. It then loads
`/clinical-notes/view/:note_ien` so structured note content and
`patient_objects` can contribute to the episode summary.

The current live check for `PAT123456` returned different counts for the two
episodes, including medications (`35` for `1-9013`, `0` for `1-1`), diagnoses,
labs, radiology, and vitals. The adapter still sends the episode identifier to
every endpoint and records provenance so a doctor can see whether a fact came
from an endpoint or a clinical note. Note detail has no episode parameter; its
episode association comes from the filtered note list.

Allergies currently have no episode parameter and remain patient-level data.

## 1. Demographics

- Method/URL: `GET /patientHome/load-demographics/:dfn?userId=1`
- Identifiers: path param `dfn`.

```jsonc
{
  "success": true,
  "data": {
    "lfname": "Rohit",          // first name
    "llname": "Sharma",         // last name
    "lsex": "Male",
    "dob": "1979-04-12",
    "lage": "47",
    "cpPID": "UHID0098712",     // UHID
    "cpIPNo": "IP-2026-44310",  // IP admission number
    "ward": "B-Wing 4F",
    "admdt": "2026-08-01 09:30",// admission datetime
    "pphy": "Dr. A. Menon",     // primary physician
    "DisDate": ""               // empty until discharge is finalized
  }
}
```

## 2. Clinical notes (list)

- Method/URL: `POST /clinical-notes/list`
- Identifiers: body `patient_dfn` (a `dfn`), `duz`, and optional full `visit_id`.
- Body: `{ patient_dfn, duz, limit, offset, date_from, date_to, search_text, status_filter, visit_id }`

```jsonc
{
  "success": true,
  "data": [
      {
        "note_ien": "271",
        "note_title": "Admission Note",
        "date_of_entry": "05 AUG 2026 14:17",
        "status_name": "UNSIGNED",
        "author_name": "Dr. Pratiksha"
      }
    ]
}
```

## 3. Clinical note detail

- Method/URL: `GET /clinical-notes/view/:note_ien`
- Identifier: path param `note_ien`.
- The adapter uses `content` and `patient_objects` from this response as
  additional evidence for the selected episode. The endpoint itself has no
  separate episode parameter; episode selection happens in the note-list call.

```jsonc
{
  "success": true,
  "data": {
    "metadata": {
      "note_ien": "39",
      "patient_dfn": "PAT123456",
      "template_name": "INITIAL ASSESSMENT NOTES"
    },
    "content": [],
    "patient_objects": {
      "vitals": [],
      "medications": [],
      "labs": []
    }
  }
}
```

Structured objects in a note are not discarded. The adapter maps note
diagnoses, problems, complaints, allergies, medications, labs, radiology, and
vitals into the normalized collections. Each mapped item retains the note IEN
and source path as provenance and is marked for doctor verification unless the
same fact is confirmed by an episode endpoint.

## 4. Lab orders

- Method/URL: `POST /lab/list`
- Identifiers: body `dfn`, `visit_id`.
- Body: `{ dfn, status, visit_id, from_date, to_date }`

```jsonc
{
  "success": true,
  "data": {
    "orders": [
      {
        "itemOrdered": "CBC with Differential",
        "section": "Haematology",
        "orderDateTime": "2026-08-01 10:15",
        "status": { "name": "COMPLETED" }   // status is an object here
      }
    ]
  }
}
```

## 5. Radiology orders

- Method/URL: `POST /rad/cpoe-list`
- Identifiers: body `dfn`, `visit_id`.
- Body: `{ dfn, status, visit_id, from_date, to_date }`

```jsonc
{
  "success": true,
  "data": {
    "orders": [
      {
        "imaging_procedure": "Chest X-Ray PA",
        "imaging_type": "X-Ray",
        "status": "COMPLETED",              // status is a string here
        "start_date_time": "2026-08-01 12:40"
      }
    ]
  }
}
```

## 6. Vitals

- Method/URL: `GET /vitals/dash/load/:dfn?fromDate=&toDate=&admissionId=&range=1`
- Identifiers: path param `dfn`, query `admissionId` (only when retrying).
- The first call (no `admissionId`) may return an empty `vitals` array but a
  populated `admissions` list; dataAccess then retries once with
  `admissionId` set to `admissions[0].id`.

```jsonc
{
  "success": true,
  "data": {
    "vitals": [
      {
        "date_time": "2026-08-01 09:45",
        "measurements": {
          "BLOOD PRESSURE": { "value": "148/92", "unit": "mmHg", "bgColor": "red" },
          "TEMPERATURE":   { "value": "38.4", "unit": "°C", "bgColor": "red" },
          "PULSE":         { "value": "96" },
          "PULSE OXIMETRY":{ "value": "95", "bgColor": "red" }
        }
      }
    ],
    "admissions": [
      { "id": "2-4", "displayName": "Ward admission" }
    ]
  }
}
```

- Measurements are an object **keyed by vital name**. `bgColor` present is
  treated as "flagged abnormal" (the API has no explicit abnormal flag).
- Normalization keys vitals by name (`BLOOD PRESSURE` → `blood pressure`) and
  drops entries whose value is empty or `"not entered"`.

## 7. Problem list

- Method/URL: `POST /problems/dash-list`
- Identifiers: body `dfn`, `visit_id`.
- Body: `{ dfn, status, visit_id }`

```jsonc
{
  "success": true,
  "data": {
    "problems": [
      {
        "problem": "Plaque psoriasis, widespread",
        "status": "ACTIVE",
        "dateOnset": "2026-08-01",
        "comorbidity": false
      }
    ]
  }
}
```

## 8. Diagnosis

- Method/URL: `POST /diagnosis/dash/list`
- Identifiers: body `dfn`, `visit_id`, `duz`.
- Body: `{ dfn, visit_id, duz }`

```jsonc
{
  "success": true,
  "data": {
    "diagnoses": [
      {
        "diagnosis": "Erythrodermic psoriasis flare",
        "isPrimary": true,
        "type": "Primary",          // "Primary" | "Secondary"
        "dateEntered": "2026-08-01 10:00"
      }
    ]
  }
}
```

- Normalization sorts primary diagnoses first, preserving API order within
  each group.

## 9. Chief complaints

- Method/URL: `GET /chiefcomplaint/dash-list/:patientIen?status=1&admissionIen=1`
- Identifiers: path param `patientIen` (**not** `dfn`), query `admissionIen`.
- The documented sample uses `patientIen=1`, `admissionIen=1`.

```jsonc
{
  "success": true,
  "data": {
    "complaints": [
      {
        "complaint_name": "Widespread redness and scaling of skin",
        "complaint_type": "Chief Complaint",  // "Chief Complaint" | "Associated Complaint"
        "remark": "Progressive over 2 weeks, involving trunk and limbs with itching",
        "date": "2026-08-01"
      }
    ]
  }
}
```

## 10. Allergies

- Method/URL: `GET /allergies/dashboard-list/:patientIen`
- Identifiers: path param `patientIen` (**not** `dfn`).
- Note the shape differs from every other endpoint: `data` is the array itself
  (not nested under `data`), and `status` is a top-level sibling.

```jsonc
{
  "success": true,
  "status": "Known allergies",      // e.g. "Known allergies" | "NKA"
  "data": [
    {
      "allergy": "Sulfonamides",
      "natureOfReaction": "Drug",   // "Drug" | "Food" | ...
      "symptoms": "Generalised rash and facial swelling",
      "date": "2018-02-11"
    }
  ]
}
```

## 11. Medications

- Method/URL: `POST /med/list?dfn=PAT123456`
- Identifiers: `dfn` in **both** the query string and the body.
- Body: `{ dfn, status, schedule_type, visit_id, from_date, to_date }`

```jsonc
{
  "success": true,
  "data": {
    "orders": [
      {
        "medication_name": "Methotrexate 15 mg weekly",
        "start_date": "2026-08-02",
        "stop_date": "",
        "status": "ACTIVE",           // "ACTIVE" | "COMPLETED" | "DISCONTINUED" | ...
        "schedule_type": "Weekly",    // coded schedule type
        "schedule": "WEEKLY",          // display schedule when supplied
        "service": "Inpt. Meds"
      }
    ]
  }
}
```

## Keeping dataAccess.js in sync

1. When a Sansys field changes, edit the corresponding response sample above.
2. The `map*` / `normalize*` helpers in `dataAccess.js` are the only place that
   read these raw fields — update them to match.
3. Mirror the change in `server/test/fixtures/patient.js` and run
   `npm test` in `server/`.
4. Do not change `server/src/contracts.md` — that is the normalized object the
   rest of the app depends on and is stable on purpose.
