// Gerador de DOCX para RAN — identidade visual de Patrízia Santarém
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, HeadingLevel, BorderStyle, WidthType, ShadingType,
  Header, Footer, PageNumber, LevelFormat, VerticalAlign, PageBreak
} = require('docx');

// Paleta de cores
const VERDE = '3D4A38';
const VERDE_LIGHT = 'E8EDE6';
const CINZA = '7A7872';
const BORDA = 'D5D2CC';
const BRANCO = 'FFFFFF';

// Margens: 1440 DXA = 1 polegada
const MARGEM = 1440;
// Largura do conteúdo em A4: 11906 - 2880 = 9026 DXA
const LARGURA_CONTEUDO = 9026;

// ── Helpers de parágrafo ──────────────────────────────────────────────────

function paragrafoVazio(espacoAntes = 0, espacoDepois = 0) {
  return new Paragraph({ children: [new TextRun('')], spacing: { before: espacoAntes, after: espacoDepois } });
}

function tituloPrincipal(texto) {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 120 },
    children: [new TextRun({
      text: texto, bold: true, size: 28,
      color: VERDE, font: 'Calibri'
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
      color: VERDE, font: 'Calibri'
    })]
  });
}

function subTitulo(texto) {
  const limpo = texto.replace(/\*\*/g, '').replace(/^#+\s*/, '').trim();
  return new Paragraph({
    spacing: { before: 160, after: 40 },
    children: [new TextRun({
      text: limpo, bold: true, size: 20,
      color: '2C3828', font: 'Calibri'
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
      size: opcoes.size || 20,
      color: opcoes.color || '2C2C2A',
      font: 'Calibri'
    }));
  }
  return runs.length ? runs : [new TextRun({ text: texto, size: 20, font: 'Calibri', color: '2C2C2A' })];
}

function itemLista(texto) {
  const limpo = texto.replace(/^[-•]\s*/, '').trim();
  return new Paragraph({
    spacing: { before: 30, after: 30 },
    indent: { left: 360, hanging: 180 },
    children: [
      new TextRun({ text: '• ', color: VERDE, bold: true, size: 20, font: 'Calibri' }),
      ...processarInline(limpo, { size: 20 })
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
              children: [new TextRun({
                text: cellText.replace(/\*\*/g, ''),
                bold: rowIdx === 0 || colIdx === 0,
                color: rowIdx === 0 ? BRANCO : '2C2C2A',
                size: 18,
                font: 'Calibri'
              })]
            })]
          })
        )
      })
    )
  });
}

// ── Cabeçalho e Rodapé ────────────────────────────────────────────────────

function gerarHeader() {
  return new Header({
    children: [
      new Paragraph({
        border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: VERDE, space: 4 } },
        spacing: { after: 80 },
        children: [
          new TextRun({ text: 'Relatório de Avaliação Neuropsicopedagógica', size: 16, color: CINZA, font: 'Calibri' }),
          new TextRun({ text: '     |     Patrízia Almeida Santarém Costa', size: 16, color: CINZA, font: 'Calibri', italics: true }),
        ]
      })
    ]
  });
}

function gerarFooter() {
  return new Footer({
    children: [
      new Paragraph({
        border: { top: { style: BorderStyle.SINGLE, size: 4, color: VERDE, space: 4 } },
        spacing: { before: 80 },
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ text: 'Neuropsicopedagoga Clínica — Uberlândia, MG     |     Pág. ', size: 16, color: CINZA, font: 'Calibri' }),
          new TextRun({ children: [PageNumber.CURRENT], size: 16, color: CINZA, font: 'Calibri' }),
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
        children: [new Paragraph({ children: [new TextRun({ text: label, bold: true, size: 20, color: VERDE, font: 'Calibri' })] })]
      }),
      new TableCell({
        borders, width: { size: 6226, type: WidthType.DXA },
        margins: { top: 80, bottom: 80, left: 160, right: 80 },
        children: [new Paragraph({ children: [new TextRun({ text: valor, size: 20, font: 'Calibri', color: '2C2C2A' })] })]
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

async function gerarDocx(contentMd, nomeArquivo) {
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
        document: { run: { font: 'Calibri', size: 20, color: '2C2C2A' } }
      }
    },
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838 }, // A4
          margin: { top: MARGEM, right: MARGEM, bottom: MARGEM, left: MARGEM }
        }
      },
      headers: { default: gerarHeader() },
      footers: { default: gerarFooter() },
      children: [
        // Título do documento
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 240, after: 60 },
          children: [new TextRun({
            text: 'RELATÓRIO DE AVALIAÇÃO NEUROPSICOPEDAGÓGICA',
            bold: true, size: 26, color: VERDE, font: 'Calibri'
          })]
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 0, after: 240 },
          children: [new TextRun({
            text: 'Patrízia Almeida Santarém Costa — Neuropsicopedagoga Clínica',
            size: 18, color: CINZA, font: 'Calibri', italics: true
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
          children: [new TextRun({ text: '_'.repeat(50), color: CINZA, size: 18, font: 'Calibri' })]
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 80 },
          children: [new TextRun({ text: 'Patrízia Almeida Santarém Costa', bold: true, size: 20, color: VERDE, font: 'Calibri' })]
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: 'Neuropsicopedagoga Clínica', size: 18, color: CINZA, font: 'Calibri', italics: true })]
        }),
      ]
    }]
  });

  return await Packer.toBuffer(doc);
}

module.exports = { gerarDocx };
