import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const ATTACHMENT_KEYS = ['type', 'fileName', 'mimeType'];

export async function loadCases(pathOrUrl) {
  const path = pathOrUrl instanceof URL ? fileURLToPath(pathOrUrl) : pathOrUrl;
  const parsed = JSON.parse(await readFile(path, 'utf8'));
  if (!Array.isArray(parsed)) throw new Error('benchmark corpus must be a JSON array');
  return parsed;
}

export function validateCases(cases) {
  const errors = [];
  const ids = new Set();
  if (!Array.isArray(cases)) return ['corpus must be an array'];

  for (const [index, item] of cases.entries()) {
    const at = `cases[${index}]`;
    if (!isPlainObject(item)) {
      errors.push(`${at} must be an object`);
      continue;
    }
    if (!isNonEmptyString(item.id)) errors.push(`${at}.id must be a non-empty string`);
    if (ids.has(item.id)) errors.push(`${at}.id must be unique: ${String(item.id)}`);
    ids.add(item.id);
    if (!isNonEmptyString(item.category)) {
      errors.push(`${at}.category must be a non-empty string`);
    }
    if (!isPlainObject(item.input)) {
      errors.push(`${at}.input must be an object`);
      continue;
    }
    if (typeof item.input.text !== 'string') errors.push(`${at}.input.text must be a string`);
    if (!Array.isArray(item.input.attachments)) {
      errors.push(`${at}.input.attachments must be an array`);
      continue;
    }
    for (const [attachmentIndex, attachment] of item.input.attachments.entries()) {
      const attachmentAt = `${at}.input.attachments[${attachmentIndex}]`;
      if (!isPlainObject(attachment)) {
        errors.push(`${attachmentAt} must be an object`);
        continue;
      }
      for (const key of ATTACHMENT_KEYS) {
        if (!isNonEmptyString(attachment[key])) {
          errors.push(`${attachmentAt}.${key} must be a non-empty string`);
        }
      }
      const extraKeys = Object.keys(attachment).filter((key) => !ATTACHMENT_KEYS.includes(key));
      if (extraKeys.length > 0) {
        errors.push(`${attachmentAt} has unsupported keys: ${extraKeys.sort().join(', ')}`);
      }
    }
  }
  return errors;
}

export function attachmentDescriptor(input) {
  return JSON.stringify({
    text: input.text,
    attachments: input.attachments.map(({ type, fileName, mimeType }) => ({
      type,
      fileName,
      mimeType,
    })),
  });
}

export function formatCaseInput(item) {
  return item.input.attachments.length > 0 ? attachmentDescriptor(item.input) : item.input.text;
}

export function corpusSha256(cases) {
  return sha256(`${JSON.stringify(cases)}\n`);
}

export function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
