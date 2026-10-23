// Readable text of a reply payload: content plus embed title/description/fields/footer.
export const textOf=p=>{const d=p?.data??p;const embeds=(d?.embeds||[]).map(e=>e?.toJSON?e.toJSON():e);return [d?.content,...embeds.flatMap(e=>[e.title,e.description,...(e.fields||[]).flatMap(f=>[f.name,f.value]),e.footer?.text])].filter(Boolean).join('\n');};
// Primary message: content, or the description of an error/notice embed.
export const messageOf=p=>{const d=p?.data??p;if(d?.content)return d.content;const e=d?.embeds?.[0];return (e?.toJSON?e.toJSON():e)?.description??d?.content;};
