const src = document.body.dataset.md;
fetch(src)
  .then(r => { if(!r.ok) throw new Error(r.status); return r.text(); })
  .then(md => { document.getElementById('content').innerHTML = marked.parse(md);
                document.title = (md.match(/^#\s+(.+)/m)?.[1] || 'Writeup') + ' | Harsh Vora'; })
  .catch(() => { document.getElementById('content').innerHTML =
    '<h1>Writeup coming soon</h1><p><em>This piece is being written. Check back shortly.</em></p>'; });
