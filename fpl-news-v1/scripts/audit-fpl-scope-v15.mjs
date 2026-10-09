// Read-only evidence for the two user-reported articles. No provider or queue calls.
const {sql, closeDb} = await import('file:///opt/tql-news/current/packages/backend/src/db.ts');
try {
  const ids = ['xsbkgjmr7esilv9wghxs4eubc', 't3naknr6wlg0iodfbvi6bqeu2'];
  const rows = await sql`
    SELECT a.id,a.revision,a.title,a.body_text,a.x_post->>'text' AS post_text,
      a.processing_state,a.grouped_at,p.eligible,p.selected,p.visibility,p.fact_id,p.story_id,
      an.relevance,an.output->'prefilter' AS prefilter,an.output->'fact' AS fact,
      o.version AS override_version,o.visibility AS override_visibility,o.fields AS override_fields,
      d.verdict AS grouping_verdict,d.candidates AS grouping_candidates
    FROM articles a LEFT JOIN publications p ON p.article_id=a.id
    LEFT JOIN LATERAL (SELECT * FROM analyses WHERE article_id=a.id ORDER BY input_revision DESC,id DESC LIMIT 1) an ON true
    LEFT JOIN editorial_overrides o ON o.article_id=a.id
    LEFT JOIN LATERAL (SELECT * FROM grouping_decisions WHERE article_id=a.id ORDER BY created_at DESC,id DESC LIMIT 1) d ON true
    WHERE a.id=ANY(${ids}) ORDER BY a.id`;
  console.log(JSON.stringify(rows,null,2));
} finally { await closeDb(); }
