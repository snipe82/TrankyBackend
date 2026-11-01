import { z } from 'zod';

z.config(z.locales.es());

export const email = z.email({ message: 'Correo electrónico inválido' });

export const uuid = z.uuid({ message: 'Identificador inválido' });

export const periodo = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Periodo debe tener formato YYYY-MM');

export const fecha = z.iso.date({ message: 'Fecha debe tener formato YYYY-MM-DD' });

export const documento = z
  .object({
    tipo_doc: z.enum(['DNI', 'CE', 'RUC']),
    num_doc: z.string().trim(),
  })
  .superRefine((value, ctx) => {
    const reglas = { DNI: /^\d{8}$/, CE: /^[A-Za-z0-9]{9,12}$/, RUC: /^\d{11}$/ };
    if (!reglas[value.tipo_doc].test(value.num_doc)) {
      ctx.addIssue({ code: 'custom', path: ['num_doc'], message: `Número de ${value.tipo_doc} inválido` });
    }
  });

export const celularPeru = z.string().regex(/^9\d{8}$/, 'Celular peruano inválido (9 dígitos, empieza con 9)');

export const paginacion = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
});
