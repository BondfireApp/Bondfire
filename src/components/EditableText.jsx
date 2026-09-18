export function EditableText({
  as: Tag = 'span',
  children,
  className = '',
  field,
  value,
  fallback = '',
  ...props
}) {
  const content = value ?? children ?? fallback ?? ''
  return (
    <Tag className={className} data-editable-field={field || undefined} {...props}>
      {content}
    </Tag>
  )
}
