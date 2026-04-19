const express = require('express');
const router = express.Router();
const { getDb } = require('../db/firestore');

// GET /api/costs
// Retorna todos os dados de custo agregados
router.get('/', async (req, res) => {
  try {
    const db = getDb();
    const patientsSnap = await db.collection('patients').get();
    
    const relatorios = [];
    let totalUsd = 0;
    let comCusto = 0;

    for (const patientDoc of patientsSnap.docs) {
      const patient = { id: patientDoc.id, ...patientDoc.data() };
      const reportsSnap = await db.collection('patients').doc(patient.id)
        .collection('reports').orderBy('generated_at', 'desc').get();

      if (reportsSnap.empty) continue;

      for (const reportDoc of reportsSnap.docs) {
        const report = { id: reportDoc.id, ...reportDoc.data() };
        let custos = null;
        let custo_usd = null;

        if (report.ran_meta) {
          try {
            const meta = JSON.parse(report.ran_meta);
            custos = meta.custos || null;
            custo_usd = custos?.total_usd || null;
          } catch (e) {}
        }

        if (custo_usd !== null) {
          totalUsd += custo_usd;
          comCusto++;
        }

        relatorios.push({
          report_id: report.id,
          patient_id: patient.id,
          patient_name: patient.full_name,
          version: report.version,
          generated_at: report.generated_at,
          score_qualidade: report.ran_meta ? (() => { try { return JSON.parse(report.ran_meta).revisao?.score_qualidade || null; } catch(e) { return null; } })() : null,
          custo_usd,
          custos_breakdown: custos,
          updated_from_version: report.updated_from_version || null
        });
      }
    }

    // Agrupa por paciente
    const porPaciente = {};
    for (const r of relatorios) {
      if (!porPaciente[r.patient_id]) {
        porPaciente[r.patient_id] = {
          patient_id: r.patient_id,
          patient_name: r.patient_name,
          relatorios: [],
          total_usd: 0,
          com_custo: 0
        };
      }
      porPaciente[r.patient_id].relatorios.push(r);
      if (r.custo_usd !== null) {
        porPaciente[r.patient_id].total_usd += r.custo_usd;
        porPaciente[r.patient_id].com_custo++;
      }
    }

    // Calcula médias por paciente
    const pacientes = Object.values(porPaciente).map(p => ({
      ...p,
      media_usd: p.com_custo > 0 ? parseFloat((p.total_usd / p.com_custo).toFixed(6)) : null,
      total_relatorios: p.relatorios.length
    })).sort((a, b) => (b.total_usd || 0) - (a.total_usd || 0));

    // Agrupa por mês
    const porMes = {};
    for (const r of relatorios) {
      if (!r.custo_usd || !r.generated_at) continue;
      const mes = r.generated_at.substring(0, 7); // YYYY-MM
      if (!porMes[mes]) porMes[mes] = { mes, total_usd: 0, count: 0 };
      porMes[mes].total_usd += r.custo_usd;
      porMes[mes].count++;
    }
    const historico_mensal = Object.values(porMes)
      .sort((a, b) => a.mes.localeCompare(b.mes))
      .map(m => ({ ...m, total_usd: parseFloat(m.total_usd.toFixed(6)) }));

    const mediaUsd = comCusto > 0 ? parseFloat((totalUsd / comCusto).toFixed(6)) : null;

    res.json({
      resumo: {
        total_relatorios: relatorios.length,
        relatorios_com_custo: comCusto,
        relatorios_sem_custo: relatorios.length - comCusto,
        total_usd: parseFloat(totalUsd.toFixed(6)),
        media_usd: mediaUsd
      },
      historico_mensal,
      por_paciente: pacientes,
      relatorios: relatorios.sort((a, b) => (b.generated_at || '').localeCompare(a.generated_at || ''))
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar custos', details: err.message });
  }
});

module.exports = router;
