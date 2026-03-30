/**
 * Format Converter: HTML ↔ Markdown
 * Handles conversion between HTML and Markdown for NeonDash message formatting
 */

export type MessageFormat = 'html' | 'markdown';

/**
 * Convert HTML to Markdown
 */
export function htmlToMarkdown(html: string): string {
  let md = html;

  // Headers
  md = md.replace(/<h3>(.*?)<\/h3>/gi, '### $1\n');
  md = md.replace(/<h4>(.*?)<\/h4>/gi, '#### $4\n');
  md = md.replace(/<h2>(.*?)<\/h2>/gi, '## $1\n');
  md = md.replace(/<h1>(.*?)<\/h1>/gi, '# $1\n');

  // Paragraphs
  md = md.replace(/<p>(.*?)<\/p>/gi, '$1\n\n');

  // Bold and italic
  md = md.replace(/<strong>(.*?)<\/strong>/gi, '**$1**');
  md = md.replace(/<b>(.*?)<\/b>/gi, '**$1**');
  md = md.replace(/<em>(.*?)<\/em>/gi, '*$1*');
  md = md.replace(/<i>(.*?)<\/i>/gi, '*$1*');

  // Code
  md = md.replace(/<code class="language-(.*?)">(.*?)<\/code>/gis, '```$1\n$2\n```');
  md = md.replace(/<pre><code>(.*?)<\/code><\/pre>/gis, '```\n$1\n```');
  md = md.replace(/<code>(.*?)<\/code>/gi, '`$1`');

  // Lists
  md = md.replace(/<ul>(.*?)<\/ul>/gis, (match, content) => {
    return content.replace(/<li>(.*?)<\/li>/gi, '- $1\n');
  });
  md = md.replace(/<ol>(.*?)<\/ol>/gis, (match, content) => {
    let counter = 1;
    return content.replace(/<li>(.*?)<\/li>/gi, () => `${counter++}. $1\n`);
  });

  // Links
  md = md.replace(/<a href="(.*?)">(.*?)<\/a>/gi, '[$2]($1)');

  // Images (keep as-is for base64, convert simple ones)
  md = md.replace(/<img src="(data:image\/[^;]+;base64,[^"]+)"[^>]*>/gi, '![image]($1)');
  md = md.replace(/<img src="([^"]+)" alt="([^"]*)"[^>]*>/gi, '![$2]($1)');
  md = md.replace(/<img src="([^"]+)"[^>]*>/gi, '![image]($1)');

  // Line breaks
  md = md.replace(/<br\s*\/?>/gi, '\n');

  // Tables (basic conversion)
  md = md.replace(/<table>(.*?)<\/table>/gis, (match, content) => {
    const rows: string[] = [];
    const headerMatch = content.match(/<thead>(.*?)<\/thead>/is);
    const bodyMatch = content.match(/<tbody>(.*?)<\/tbody>/is);

    if (headerMatch) {
      const headerCells = headerMatch[1].match(/<th>(.*?)<\/th>/gi);
      if (headerCells) {
        const headers = headerCells.map((c: string) => c.replace(/<\/?th>/gi, '').trim());
        rows.push('| ' + headers.join(' | ') + ' |');
        rows.push('| ' + headers.map(() => '---').join(' | ') + ' |');
      }
    }

    if (bodyMatch) {
      const bodyRows = bodyMatch[1].match(/<tr>(.*?)<\/tr>/gis);
      if (bodyRows) {
        bodyRows.forEach((row: string) => {
          const cells = row.match(/<td>(.*?)<\/td>/gi);
          if (cells) {
            const cellContents = cells.map((c: string) => c.replace(/<\/?td>/gi, '').trim());
            rows.push('| ' + cellContents.join(' | ') + ' |');
          }
        });
      }
    }

    return rows.join('\n') + '\n\n';
  });

  // Clean up extra whitespace
  md = md.replace(/\n\n\n+/g, '\n\n');
  md = md.trim();

  return md;
}

/**
 * Convert Markdown to HTML
 */
export function markdownToHtml(markdown: string): string {
  let html = markdown;

  // Escape HTML entities first
  html = html.replace(/&/g, '&amp;');
  html = html.replace(/</g, '&lt;');
  html = html.replace(/>/g, '&gt;');

  // Code blocks (must come before inline code)
  html = html.replace(/```(\w+)?\n(.*?)\n```/gis, (match, lang, code) => {
    const language = lang || '';
    return `<pre><code class="language-${language}">${code}</code></pre>`;
  });

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Headers
  html = html.replace(/^#### (.*?)$/gm, '<h4>$1</h4>');
  html = html.replace(/^### (.*?)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.*?)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.*?)$/gm, '<h1>$1</h1>');

  // Bold and italic (must come in right order)
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/___(.+?)___/g, '<strong><em>$1</em></strong>');
  html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
  html = html.replace(/_(.+?)_/g, '<em>$1</em>');

  // Links (must restore HTML for markdown links)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // Images (must restore HTML)
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">');

  // Unordered lists
  html = html.replace(/^[\*\-\+] (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>)\n?/gs, '<ul>$1</ul>');
  html = html.replace(/<\/ul>\n<ul>/g, ''); // Merge consecutive lists

  // Ordered lists
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>)\n?(?!<ul>)/gs, '<ol>$1</ol>');
  html = html.replace(/<\/ol>\n<ol>/g, ''); // Merge consecutive lists

  // Line breaks and paragraphs
  html = html.replace(/\n\n/g, '</p><p>');
  html = html.replace(/^(?!<[huo])/gm, '<p>');
  html = html.replace(/(?<!>)$/gm, '</p>');

  // Clean up empty paragraphs and fix nesting
  html = html.replace(/<p><\/p>/g, '');
  html = html.replace(/<p>(<[huo])/g, '$1');
  html = html.replace(/(<\/[huo][^>]*>)<\/p>/g, '$1');

  return html.trim();
}

/**
 * Convert message to the specified format
 */
export function convertMessage(message: string, targetFormat: MessageFormat): string {
  // Detect current format by looking for HTML tags
  const isHtml = /<[a-z][\s\S]*>/i.test(message);

  if (targetFormat === 'html' && !isHtml) {
    return markdownToHtml(message);
  } else if (targetFormat === 'markdown' && isHtml) {
    return htmlToMarkdown(message);
  }

  // Already in target format
  return message;
}
