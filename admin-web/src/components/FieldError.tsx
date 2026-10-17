export function FieldError({ id, message }: { id: string; message: string | undefined }) {
  return message ? <p id={id} role="alert" className="mt-2 text-xs leading-5 text-danger-fg">{message}</p> : null
}
