import type { InputHTMLAttributes, TextareaHTMLAttributes, SelectHTMLAttributes, ReactNode } from 'react';

interface FieldProps {
  label?: string;
  error?: string | null;
  hint?: string;
}

export function Input({
  label,
  error,
  hint,
  className = '',
  ...rest
}: FieldProps & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="field">
      {label && <label>{label}</label>}
      <input className={`input ${error ? 'has-error' : ''} ${className}`} {...rest} />
      {error ? <span className="field-error">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </div>
  );
}

export function TextArea({
  label,
  error,
  hint,
  className = '',
  ...rest
}: FieldProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <div className="field">
      {label && <label>{label}</label>}
      <textarea className={`textarea ${error ? 'has-error' : ''} ${className}`} {...rest} />
      {error ? <span className="field-error">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </div>
  );
}

export function Select({
  label,
  error,
  hint,
  children,
  className = '',
  ...rest
}: FieldProps & SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  return (
    <div className="field">
      {label && <label>{label}</label>}
      <select className={`select ${error ? 'has-error' : ''} ${className}`} {...rest}>
        {children}
      </select>
      {error ? <span className="field-error">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </div>
  );
}
