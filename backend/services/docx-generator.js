// Gerador de DOCX para RAN — identidade visual de Patrízia Santarém
const {
  Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell,
  AlignmentType, HeadingLevel, BorderStyle, WidthType, ShadingType,
  Header, Footer, PageNumber, LevelFormat, VerticalAlign, PageBreak
} = require('docx');
const { getDb } = require('../db/firestore');

// Paleta de cores
const VERDE = '3D4A38';
const VERDE_LIGHT = 'E8EDE6';
const CINZA = '7A7872';
const BORDA = 'D5D2CC';
const BRANCO = 'FFFFFF';

const FONTES_PERMITIDAS = ['Arial', 'Helvetica', 'Times New Roman', 'Georgia', 'Verdana', 'Courier New'];

// Estado de layout por geração — monousuário, sem risco de corrida
let _fonte = 'Arial';
let _tamanho = 22; // half-points = 11pt padrão

// Margens: 1440 DXA = 1 polegada
const MARGEM = 1440;
// Largura do conteúdo em A4: 11906 - 2880 = 9026 DXA
const LARGURA_CONTEUDO = 9026;

// ── Helpers de parágrafo ──────────────────────────────────────────────────

function paragrafoVazio(espacoAntes = 0, espacoDepois = 0) {
  return new Paragraph({ children: [new TextRun('')], spacing: { before: espacoAntes, after: espacoDepois } });
}

async function carregarLayout(userEmail) {
  const defaults = { fonte: 'Arial', tamanho: 22, cabecalho: null, logo_url: null };
  if (!userEmail) return defaults;
  try {
    const doc = await getDb().collection('report_layout').doc(userEmail).get();
    if (!doc.exists) return defaults;
    const d = doc.data();
    const fonteValida = FONTES_PERMITIDAS.includes(d.fonte) ? d.fonte : 'Arial';
    const ptNum = parseInt(d.tamanho, 10);
    const tamanhoHP = (!isNaN(ptNum) && ptNum >= 8 && ptNum <= 36) ? ptNum * 2 : 22;
    return { fonte: fonteValida, tamanho: tamanhoHP, cabecalho: d.cabecalho || null, logo_url: d.logo_url || null };
  } catch (err) {
    console.warn('[DocxGenerator] carregarLayout falhou — usando defaults:', err.message);
    return defaults;
  }
}

async function baixarImagem(url) {
  return new Promise((resolve) => {
    try {
      const proto = url.startsWith('https') ? require('https') : require('http');
      const req = proto.get(url, (res) => {
        if (res.statusCode < 200 || res.statusCode >= 300) { resolve(null); return; }
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', () => resolve(null));
      });
      req.on('error', () => resolve(null));
      req.setTimeout(5000, () => { req.destroy(); resolve(null); });
    } catch { resolve(null); }
  });
}

function detectarTipoImagem(buffer) {
  if (!buffer || buffer.length < 4) return 'png';
  if (buffer[0] === 0xFF && buffer[1] === 0xD8) return 'jpg';
  if (buffer[0] === 0x89 && buffer[1] === 0x50) return 'png';
  if (buffer[0] === 0x47 && buffer[1] === 0x49) return 'gif';
  return 'png';
}

function tituloPrincipal(texto) {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 120 },
    children: [new TextRun({
      text: texto, bold: true, size: 28,
      color: VERDE, font: 'Arial'
    })]
  });
}

function tituloSecao(texto) {
  // Limpa o Markdown do título: remove **, #, etc.
  const limpo = texto.replace(/\*\*/g, '').replace(/^#+\s*/, '').trim();
  return new Paragraph({
    spacing: { before: 280, after: 80 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: VERDE, space: 4 } },
    children: [new TextRun({
      text: limpo.toUpperCase(), bold: true, size: 22,
      color: VERDE, font: 'Arial'
    })]
  });
}

function subTitulo(texto) {
  const limpo = texto.replace(/\*\*/g, '').replace(/^#+\s*/, '').trim();
  return new Paragraph({
    spacing: { before: 160, after: 40 },
    children: [new TextRun({
      text: limpo, bold: true, size: 20,
      color: '2C3828', font: 'Arial'
    })]
  });
}

function parágrafoTexto(texto, opcoes = {}) {
  // Processa inline: **bold** e *italic*
  const runs = processarInline(texto, opcoes);
  return new Paragraph({
    spacing: { before: 40, after: 40 },
    alignment: opcoes.center ? AlignmentType.CENTER : AlignmentType.JUSTIFIED,
    children: runs
  });
}

function processarInline(texto, opcoes = {}) {
  const runs = [];
  // Remove ** de início e fim e processa formatação inline
  const partes = texto.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
  for (const parte of partes) {
    if (!parte) continue;
    const isBold = parte.startsWith('**') && parte.endsWith('**');
    const isItalic = !isBold && parte.startsWith('*') && parte.endsWith('*');
    const textoLimpo = isBold ? parte.slice(2, -2) : isItalic ? parte.slice(1, -1) : parte;
    runs.push(new TextRun({
      text: textoLimpo,
      bold: isBold || opcoes.bold,
      italics: isItalic || opcoes.italic,
      size: opcoes.size || _tamanho,
      color: opcoes.color || '2C2C2A',
      font: _fonte
    }));
  }
  return runs.length ? runs : [new TextRun({ text: texto, size: _tamanho, font: _fonte, color: '2C2C2A' })];
}

function itemLista(texto) {
  const limpo = texto.replace(/^[-•]\s*/, '').trim();
  return new Paragraph({
    spacing: { before: 30, after: 30 },
    indent: { left: 360, hanging: 180 },
    children: [
      new TextRun({ text: '• ', color: VERDE, bold: true, size: _tamanho, font: _fonte }),
      ...processarInline(limpo, { size: _tamanho })
    ]
  });
}

// ── Tabelas Markdown ───────────────────────────────────────────────────────

function parsearTabela(linhas) {
  const rows = [];
  for (const linha of linhas) {
    if (linha.match(/^\|[-:\s|]+\|$/)) continue; // separador
    const cells = linha.split('|').filter((_, i, a) => i > 0 && i < a.length - 1).map(c => c.trim());
    if (cells.length) rows.push(cells);
  }
  return rows;
}

function cellaParaRuns(cellText, bold, color) {
  const partes = cellText.replace(/\*\*/g, '').split(/<br\s*\/?>/gi);
  return partes.map((texto, idx) => {
    const run = { text: texto.trim(), bold, color, size: 18, font: 'Arial' };
    if (idx > 0) run.break = 1;
    return new TextRun(run);
  });
}

function gerarTabela(rows) {
  if (!rows.length) return null;
  const numCols = rows[0].length;
  const colWidth = Math.floor(LARGURA_CONTEUDO / numCols);
  const colWidths = Array(numCols).fill(colWidth);
  const borderConfig = { style: BorderStyle.SINGLE, size: 4, color: BORDA };
  const borders = { top: borderConfig, bottom: borderConfig, left: borderConfig, right: borderConfig };

  return new Table({
    width: { size: LARGURA_CONTEUDO, type: WidthType.DXA },
    columnWidths: colWidths,
    rows: rows.map((cells, rowIdx) =>
      new TableRow({
        children: cells.map((cellText, colIdx) =>
          new TableCell({
            borders,
            width: { size: colWidths[colIdx], type: WidthType.DXA },
            margins: { top: 80, bottom: 80, left: 120, right: 120 },
            shading: rowIdx === 0
              ? { fill: VERDE, type: ShadingType.CLEAR }
              : colIdx === 0
                ? { fill: 'F3F0EB', type: ShadingType.CLEAR }
                : { fill: BRANCO, type: ShadingType.CLEAR },
            verticalAlign: VerticalAlign.CENTER,
            children: [new Paragraph({
              alignment: AlignmentType.LEFT,
              children: cellaParaRuns(cellText, rowIdx === 0 || colIdx === 0, rowIdx === 0 ? BRANCO : '2C2C2A')
            })]
          })
        )
      })
    )
  });
}

// ── Cabeçalho e Rodapé ────────────────────────────────────────────────────

function gerarHeader(cabecalho, logoBuffer) {
  const children = [];
  if (logoBuffer) {
    children.push(new Paragraph({
      spacing: { before: 0, after: 40 },
      children: [new ImageRun({ data: logoBuffer, transformation: { width: 120, height: 40 }, type: detectarTipoImagem(logoBuffer) })]
    }));
  }
  const headerRuns = cabecalho
    ? [new TextRun({ text: cabecalho, size: 16, color: CINZA, font: 'Arial' })]
    : [
        new TextRun({ text: 'Relatório de Avaliação Neuropsicopedagógica', size: 16, color: CINZA, font: 'Arial' }),
        new TextRun({ text: '     |     Patrízia Almeida Santarém Costa', size: 16, color: CINZA, font: 'Arial', italics: true }),
      ];
  children.push(new Paragraph({
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: VERDE, space: 4 } },
    spacing: { after: 80 },
    children: headerRuns
  }));
  return new Header({ children });
}

function gerarFooter() {
  return new Footer({
    children: [
      new Paragraph({
        border: { top: { style: BorderStyle.SINGLE, size: 4, color: VERDE, space: 4 } },
        spacing: { before: 80 },
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ text: 'Neuropsicopedagoga Clínica — Uberlândia, MG     |     Pág. ', size: 16, color: CINZA, font: 'Arial' }),
          new TextRun({ children: [PageNumber.CURRENT], size: 16, color: CINZA, font: 'Arial' }),
        ]
      })
    ]
  });
}

// ── Parser principal de Markdown → elementos DOCX ─────────────────────────

function parsearMarkdown(md) {
  const elementos = [];
  const linhas = md.split('\n');
  let i = 0;

  while (i < linhas.length) {
    const linha = linhas[i];

    // Tabela
    if (linha.startsWith('|')) {
      const blocoTabela = [];
      while (i < linhas.length && linhas[i].startsWith('|')) {
        blocoTabela.push(linhas[i]);
        i++;
      }
      const rows = parsearTabela(blocoTabela);
      const tabela = gerarTabela(rows);
      if (tabela) {
        elementos.push(tabela);
        elementos.push(paragrafoVazio(60));
      }
      continue;
    }

    // Separador ---
    if (linha.match(/^---+$/)) {
      elementos.push(paragrafoVazio(120, 120));
      i++;
      continue;
    }

    // Título H1 ou cabeçalho RAN
    if (linha.startsWith('# ')) {
      const texto = linha.slice(2).trim();
      if (texto.includes('RELATÓRIO') || texto.includes('RAN')) {
        elementos.push(tituloPrincipal(texto));
      } else {
        elementos.push(tituloSecao(texto));
      }
      i++;
      continue;
    }

    // H2 — seções principais
    if (linha.startsWith('## ')) {
      elementos.push(tituloSecao(linha.slice(3)));
      i++;
      continue;
    }

    // H3 — subseções
    if (linha.startsWith('### ')) {
      elementos.push(subTitulo(linha.slice(4)));
      i++;
      continue;
    }

    // Negrito standalone como subtítulo (ex: **3.1 Histórico**)
    if (linha.match(/^\*\*[^*]+\*\*$/) || linha.match(/^\*\*[^*]+\*\*\s*$/)) {
      elementos.push(subTitulo(linha));
      i++;
      continue;
    }

    // Item de lista
    if (linha.startsWith('- ') || linha.startsWith('• ')) {
      elementos.push(itemLista(linha));
      i++;
      continue;
    }

    // Linha vazia
    if (linha.trim() === '') {
      elementos.push(paragrafoVazio(40));
      i++;
      continue;
    }

    // Parágrafo normal
    if (linha.trim()) {
      elementos.push(parágrafoTexto(linha));
    }
    i++;
  }

  return elementos;
}

// ── Bloco de cabeçalho estruturado (dados do paciente) ────────────────────

function gerarBlocoIdentificacao(linhasSecao1) {
  // Extrai dados do cabeçalho da seção 1
  const campo = (label) => {
    const linha = linhasSecao1.find(l => l.includes(label));
    if (!linha) return '[Não informado]';
    return linha.split(':').slice(1).join(':').trim()
      .replace(/\*\*/g, '').replace(/\[.*?\]/g, '').trim() || '[Não informado]';
  };

  const nome = campo('Nome da Criança') || campo('Nome');
  const nascimento = campo('Data de Nascimento') || campo('Nascimento');
  const idade = campo('Idade');
  const escolaridade = campo('Escolaridade');
  const dominancia = campo('Dominância');
  const medicamentos = campo('medicamentos') || campo('Medicamentos');
  const responsaveis = campo('Responsáveis') || campo('Responsavel');

  const borderConfig = { style: BorderStyle.SINGLE, size: 4, color: BORDA };
  const borders = { top: borderConfig, bottom: borderConfig, left: borderConfig, right: borderConfig };

  const linha = (label, valor) => new TableRow({
    children: [
      new TableCell({
        borders, width: { size: 2800, type: WidthType.DXA },
        margins: { top: 80, bottom: 80, left: 160, right: 80 },
        shading: { fill: 'F3F0EB', type: ShadingType.CLEAR },
        children: [new Paragraph({ children: [new TextRun({ text: label, bold: true, size: 20, color: VERDE, font: 'Arial' })] })]
      }),
      new TableCell({
        borders, width: { size: 6226, type: WidthType.DXA },
        margins: { top: 80, bottom: 80, left: 160, right: 80 },
        children: [new Paragraph({ children: [new TextRun({ text: valor, size: 20, font: 'Arial', color: '2C2C2A' })] })]
      })
    ]
  });

  return new Table({
    width: { size: LARGURA_CONTEUDO, type: WidthType.DXA },
    columnWidths: [2800, 6226],
    rows: [
      linha('Nome completo', nome),
      linha('Data de nascimento / Idade', `${nascimento}  |  ${idade}`),
      linha('Escolaridade', escolaridade),
      linha('Dominância manual', dominancia),
      linha('Medicamentos', medicamentos),
      linha('Responsáveis', responsaveis),
    ]
  });
}

// ── Função principal exportada ─────────────────────────────────────────────

async function gerarDocx(contentMd, nomeArquivo, userEmail) {
  let layout = { fonte: 'Arial', tamanho: 22, cabecalho: null, logo_url: null };
  let logoBuffer = null;
  try {
    layout = await carregarLayout(userEmail);
    if (layout.logo_url) logoBuffer = await baixarImagem(layout.logo_url);
  } catch (err) {
    console.warn('[DocxGenerator] Erro ao aplicar layout — usando defaults:', err.message);
  }
  _fonte = layout.fonte;
  _tamanho = layout.tamanho;

  // Separa seção 1 (cabeçalho) do resto
  const linhas = contentMd.split('\n');
  const inicioSecao2 = linhas.findIndex(l => l.startsWith('## ') && !l.includes('RELATÓRIO'));
  const linhasSecao1 = inicioSecao2 > 0 ? linhas.slice(0, inicioSecao2) : linhas.slice(0, 15);
  const restoMd = inicioSecao2 > 0 ? linhas.slice(inicioSecao2).join('\n') : contentMd;

  const blocoId = gerarBlocoIdentificacao(linhasSecao1);
  const conteudo = parsearMarkdown(restoMd);

  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: layout.fonte, size: layout.tamanho, color: '2C2C2A' } }
      }
    },
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838 }, // A4
          margin: { top: MARGEM, right: MARGEM, bottom: MARGEM, left: MARGEM }
        }
      },
      headers: { default: gerarHeader(layout.cabecalho, logoBuffer) },
      footers: { default: gerarFooter() },
      children: [
        // Título do documento
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 240, after: 60 },
          children: [new TextRun({
            text: 'RELATÓRIO DE AVALIAÇÃO NEUROPSICOPEDAGÓGICA',
            bold: true, size: 26, color: VERDE, font: 'Arial'
          })]
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 0, after: 240 },
          children: [new TextRun({
            text: 'Patrízia Almeida Santarém Costa — Neuropsicopedagoga Clínica',
            size: 18, color: CINZA, font: 'Arial', italics: true
          })]
        }),

        // Bloco de identificação
        blocoId,
        paragrafoVazio(200),

        // Resto do conteúdo
        ...conteudo,

        // Assinatura
        paragrafoVazio(400),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: '_'.repeat(50), color: CINZA, size: 18, font: 'Arial' })]
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 80 },
          children: [new TextRun({ text: 'Patrízia Almeida Santarém Costa', bold: true, size: 20, color: VERDE, font: 'Arial' })]
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: 'Neuropsicopedagoga Clínica', size: 18, color: CINZA, font: 'Arial', italics: true })]
        }),
      ]
    }]
  });

  return await Packer.toBuffer(doc);
}

module.exports = { gerarDocx };

// Converte HTML rico (do editor Quill) para DOCX
// Usa html-to-docx ou parseia o HTML manualmente
async function gerarDocxDeHtml(htmlContent, patientId) {
  const {
    Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
    AlignmentType, BorderStyle, WidthType, ShadingType, VerticalAlign,
    Header, Footer, PageNumber
  } = require('docx');

  // Parser simples de HTML → elementos docx
  // Para HTML complexo do Quill, usamos uma abordagem de extração de texto com formatação
  const elementos = parsearHtmlParaDocx(htmlContent);

  const doc = new Document({
    styles: {
      default: { document: { run: { font: 'Arial', size: 20, color: '2C2C2A' } } }
    },
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838 },
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }
        }
      },
      headers: { default: gerarHeader() },
      footers: { default: gerarFooter() },
      children: elementos
    }]
  });

  return await Packer.toBuffer(doc);
}

function parsearHtmlParaDocx(html) {
  const { Paragraph, TextRun, AlignmentType } = require('docx');
  const elementos = [];

  // Remove tags de script/style
  html = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  html = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

  // Divide por blocos (p, h1-h6, li, tr)
  const blocos = html.split(/(<\/?(p|h[1-6]|li|tr|div|blockquote)[^>]*>)/gi)
    .filter(b => b && !b.match(/^<\/?(p|h[1-6]|li|tr|div|blockquote)/i));

  for (const bloco of blocos) {
    const textoLimpo = bloco.replace(/<[^>]+>/g, '').trim();
    if (!textoLimpo) continue;

    // Detecta tipo pelo contexto
    const runs = extrairRunsDoHtml(bloco);
    if (runs.length > 0) {
      elementos.push(new Paragraph({
        spacing: { before: 60, after: 60 },
        children: runs
      }));
    }
  }

  return elementos.length > 0 ? elementos : [new Paragraph({ children: [new TextRun({ text: '', font: 'Arial' })] })];
}

function extrairRunsDoHtml(html) {
  const { TextRun } = require('docx');
  const runs = [];

  // Remove tags preservando texto com formatação
  const partes = html.split(/(<(?:strong|b|em|i|u|span|a)[^>]*>|<\/(?:strong|b|em|i|u|span|a)>)/gi);

  let bold = false, italic = false, underline = false, color = null;

  for (const parte of partes) {
    if (parte.match(/^<(strong|b)>/i)) { bold = true; continue; }
    if (parte.match(/^<\/(strong|b)>/i)) { bold = false; continue; }
    if (parte.match(/^<(em|i)>/i)) { italic = true; continue; }
    if (parte.match(/^<\/(em|i)>/i)) { italic = false; continue; }
    if (parte.match(/^<u>/i)) { underline = true; continue; }
    if (parte.match(/^<\/u>/i)) { underline = false; continue; }
    if (parte.match(/^<span/i)) {
      const colorMatch = parte.match(/color:\s*([#\w]+)/i);
      if (colorMatch) color = colorMatch[1].replace('#', '');
      continue;
    }
    if (parte.match(/^<\/span>/i)) { color = null; continue; }
    if (parte.match(/^</)) continue; // outra tag

    const texto = parte.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&nbsp;/g,' ');
    if (texto.trim()) {
      runs.push(new TextRun({
        text: texto, bold, italics: italic, underline: underline ? {} : undefined,
        color: color || '2C2C2A', font: 'Arial', size: 20
      }));
    }
  }

  return runs;
}


// Gera PDF a partir de Markdown — fallback quando não há Google Doc
async function gerarPdfDeMarkdown(contentMd, patientName, version) {
  const PDFDocument = require('pdfkit');
  
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 60, bottom: 60, left: 70, right: 70 },
      info: {
        Title: `RAN - ${patientName} - v${version}`,
        Author: 'Patrízia Almeida Santarém Costa',
        Subject: 'Relatório de Avaliação Neuropsicopedagógica'
      }
    });

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const VERDE = '#3D4A38';
    const CINZA = '#7A7872';
    const TEXTO = '#2C2C2A';

    // Registra fonte padrão
    doc.font('Helvetica');

    // Header em cada página
    doc.on('pageAdded', () => {
      doc.fontSize(8).fillColor(CINZA)
        .text('Relatório de Avaliação Neuropsicopedagógica · Patrízia Almeida Santarém Costa', 70, 20, { align: 'center' });
      doc.moveTo(70, 35).lineTo(525, 35).strokeColor(VERDE).lineWidth(0.5).stroke();
    });

    const lines = contentMd.split('\n');
    let y = 60;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) { doc.moveDown(0.3); continue; }

      // H1
      if (trimmed.startsWith('# ')) {
        const text = trimmed.slice(2).replace(/\*\*/g, '');
        doc.fontSize(16).font('Helvetica-Bold').fillColor(VERDE)
          .text(text, { align: 'center' });
        doc.moveDown(0.5);
      }
      // H2
      else if (trimmed.startsWith('## ')) {
        const text = trimmed.slice(3).replace(/\*\*/g, '');
        doc.moveDown(0.3);
        doc.moveTo(70, doc.y).lineTo(525, doc.y).strokeColor(VERDE).lineWidth(0.5).stroke();
        doc.moveDown(0.2);
        doc.fontSize(13).font('Helvetica-Bold').fillColor(VERDE).text(text.toUpperCase());
        doc.moveDown(0.3);
      }
      // H3
      else if (trimmed.startsWith('### ')) {
        const text = trimmed.slice(4).replace(/\*\*/g, '');
        doc.fontSize(11).font('Helvetica-Bold').fillColor(TEXTO).text(text);
        doc.moveDown(0.2);
      }
      // Separador ---
      else if (trimmed.match(/^---+$/)) {
        doc.moveDown(0.3);
        doc.moveTo(70, doc.y).lineTo(525, doc.y).strokeColor('#E5E2DC').lineWidth(0.5).stroke();
        doc.moveDown(0.3);
      }
      // Lista
      else if (trimmed.startsWith('- ') || trimmed.startsWith('• ')) {
        const text = trimmed.slice(2).replace(/\*\*(.+?)\*\*/g, '$1');
        doc.fontSize(10).font('Helvetica').fillColor(TEXTO)
          .text('• ' + text, { indent: 15 });
      }
      // Linha de tabela
      else if (trimmed.startsWith('|')) {
        if (trimmed.match(/^\|[-:\s|]+\|$/)) continue; // separador
        const cells = trimmed.split('|').filter(c => c.trim()).map(c => c.trim().replace(/\*\*/g, ''));
        if (cells.length > 0) {
          const colW = Math.floor(455 / cells.length);
          let x = 70;
          const isHeader = !lines[lines.indexOf(line) + 1] || lines[lines.indexOf(line) + 1].match(/^\|[-:\s|]+\|$/);
          cells.forEach(cell => {
            doc.rect(x, doc.y, colW, 18).strokeColor('#D5D2CC').lineWidth(0.3).stroke();
            if (isHeader) doc.rect(x, doc.y, colW, 18).fillColor(VERDE).fill();
            doc.fontSize(8).font(isHeader ? 'Helvetica-Bold' : 'Helvetica')
              .fillColor(isHeader ? '#FFFFFF' : TEXTO)
              .text(cell, x + 3, doc.y + 4, { width: colW - 6, height: 14, ellipsis: true });
            x += colW;
          });
          doc.moveDown(1.2);
        }
      }
      // Negrito standalone (subtítulo)
      else if (trimmed.match(/^\*\*[^*]+\*\*$/)) {
        const text = trimmed.replace(/\*\*/g, '');
        doc.fontSize(10).font('Helvetica-Bold').fillColor(TEXTO).text(text);
        doc.moveDown(0.1);
      }
      // Parágrafo normal
      else {
        const text = trimmed.replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1');
        doc.fontSize(10).font('Helvetica').fillColor(TEXTO)
          .text(text, { align: 'justify' });
        doc.moveDown(0.2);
      }
    }

    // Footer
    doc.fontSize(8).fillColor(CINZA)
      .text('Neuropsicopedagoga Clínica · Uberlândia, MG', 70, doc.page.height - 40, { align: 'center' });

    doc.end();
  });
}

module.exports = { gerarDocx, gerarDocxDeHtml, gerarPdfDeMarkdown };
