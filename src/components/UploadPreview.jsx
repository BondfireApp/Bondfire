import React from 'react'

export default function UploadPreview({ file }){
  if(!file) return null
  const { name, type, dataUrl } = file
  if (type.startsWith('image/')) return <img src={dataUrl} alt={name} style={{maxWidth:'100%', borderRadius:10}}/>
  if (type==='application/pdf') return <iframe title={name} src={dataUrl} style={{width:'100%', height:400, border:'1px solid #222', borderRadius:10}}/>
  if (type.startsWith('audio/')) return <audio controls src={dataUrl} style={{width:'100%'}}/>
  if (type.startsWith('video/')) return <video controls src={dataUrl} style={{width:'100%', borderRadius:10}}/>
  return <a className="btn" href={dataUrl} download={name}>Download {name}</a>
}
