import type { ParsedLine } from '../parser';
import { registerHrToXml, registerXmlToHr, stepOpen, stepSelfClose, cdata, escXml } from '../step-registry';

// --- # (comment) ---
registerHrToXml({
  stepNames: ['# (comment)'],
  toXml(line: ParsedLine): string {
    const text = line.commentText ?? '';
    if (!text) {
      return stepSelfClose('# (comment)', !line.disabled);
    }
    return [
      stepOpen('# (comment)', !line.disabled),
      `    <Text>${text}</Text>`,
      '  </Step>',
    ].join('\n');
  },
});

registerXmlToHr({
  xmlStepNames: ['# (comment)'],
  toHR(el: Element): string {
    const text = el.querySelector('Text')?.textContent ?? '';
    return `# ${text}`;
  },
});

// --- If ---
registerHrToXml({
  stepNames: ['If'],
  toXml(line: ParsedLine): string {
    const condition = line.params[0] ?? '';
    return [
      stepOpen('If', !line.disabled),
      '    <Restore state="False"/>',
      `    <Calculation>${cdata(condition)}</Calculation>`,
      '  </Step>',
    ].join('\n');
  },
});

registerXmlToHr({
  xmlStepNames: ['If'],
  toHR(el: Element): string {
    const calc = el.querySelector('Calculation')?.textContent ?? '';
    return calc ? `If [ ${calc} ]` : 'If';
  },
});

// --- Else If ---
registerHrToXml({
  stepNames: ['Else If'],
  toXml(line: ParsedLine): string {
    const condition = line.params[0] ?? '';
    return [
      stepOpen('Else If', !line.disabled),
      '    <Restore state="False"/>',
      `    <Calculation>${cdata(condition)}</Calculation>`,
      '  </Step>',
    ].join('\n');
  },
});

registerXmlToHr({
  xmlStepNames: ['Else If'],
  toHR(el: Element): string {
    const calc = el.querySelector('Calculation')?.textContent ?? '';
    return calc ? `Else If [ ${calc} ]` : 'Else If';
  },
});

// --- Else ---
registerHrToXml({
  stepNames: ['Else'],
  toXml(line: ParsedLine): string {
    return [
      stepOpen('Else', !line.disabled),
      '    <Restore state="False"/>',
      '  </Step>',
    ].join('\n');
  },
});

registerXmlToHr({
  xmlStepNames: ['Else'],
  toHR(): string {
    return 'Else';
  },
});

// --- End If ---
registerHrToXml({
  stepNames: ['End If'],
  toXml(line: ParsedLine): string {
    return stepSelfClose('End If', !line.disabled);
  },
});

registerXmlToHr({
  xmlStepNames: ['End If'],
  toHR(): string {
    return 'End If';
  },
});

// --- Loop ---
registerHrToXml({
  stepNames: ['Loop'],
  toXml(line: ParsedLine): string {
    return [
      stepOpen('Loop', !line.disabled),
      '    <Restore state="False"/>',
      '    <FlushType value="Always"/>',
      '  </Step>',
    ].join('\n');
  },
});

registerXmlToHr({
  xmlStepNames: ['Loop'],
  toHR(): string {
    return 'Loop';
  },
});

// --- Exit Loop If ---
registerHrToXml({
  stepNames: ['Exit Loop If'],
  toXml(line: ParsedLine): string {
    const condition = line.params[0] ?? 'True';
    return [
      stepOpen('Exit Loop If', !line.disabled),
      `    <Calculation>${cdata(condition)}</Calculation>`,
      '  </Step>',
    ].join('\n');
  },
});

registerXmlToHr({
  xmlStepNames: ['Exit Loop If'],
  toHR(el: Element): string {
    const calc = el.querySelector('Calculation')?.textContent ?? '';
    return `Exit Loop If [ ${calc} ]`;
  },
});

// --- End Loop ---
registerHrToXml({
  stepNames: ['End Loop'],
  toXml(line: ParsedLine): string {
    return stepSelfClose('End Loop', !line.disabled);
  },
});

registerXmlToHr({
  xmlStepNames: ['End Loop'],
  toHR(): string {
    return 'End Loop';
  },
});

// --- Exit Script ---
registerHrToXml({
  stepNames: ['Exit Script'],
  toXml(line: ParsedLine): string {
    let result = '';
    if (line.params.length > 0) {
      const param = line.params[0];
      // Handle "Result: value" label
      const resultMatch = param.match(/^Result:\s*(.*)$/i);
      result = resultMatch ? resultMatch[1].trim() : param;
    }
    return [
      stepOpen('Exit Script', !line.disabled),
      `    <Calculation>${cdata(result)}</Calculation>`,
      '  </Step>',
    ].join('\n');
  },
});

registerXmlToHr({
  xmlStepNames: ['Exit Script'],
  toHR(el: Element): string {
    const calc = el.querySelector('Calculation')?.textContent ?? '';
    // FM's SW label is "Text Result:" — must byte-match snippet_to_hr.py.
    if (calc) return `Exit Script [ Text Result: ${calc} ]`;
    return 'Exit Script';
  },
});

// --- Set Variable ---

/**
 * Parse a variable name that may include a repetition suffix.
 * e.g. "$TASK_NAME[1]" -> { name: "$TASK_NAME", rep: "1" }
 * e.g. "$myVar" -> { name: "$myVar", rep: null }
 * e.g. "$arr[Get(ActiveRepetitionNumber)]" -> { name: "$arr", rep: "Get(ActiveRepetitionNumber)" }
 */
function parseVarRepetition(raw: string): { name: string; rep: string | null } {
  const match = raw.match(/^(.+?)\[(.+)\]$/);
  if (!match) return { name: raw, rep: null };
  return { name: match[1], rep: match[2] };
}

registerHrToXml({
  stepNames: ['Set Variable'],
  toXml(line: ParsedLine): string {
    const rawName = line.params[0] ?? '$var';
    let value = line.params[1] ?? '';
    let rep = line.params[2];
    // Strip "Value:" label prefix (same pattern as Exit Script's "Result:")
    const valueMatch = value.match(/^Value:\s*([\s\S]*)$/i);
    if (valueMatch) value = valueMatch[1].trim();
    // Strip "Repetition:" label prefix from explicit 3rd param
    if (rep) {
      const repMatch = rep.match(/^Repetition:\s*([\s\S]*)$/i);
      if (repMatch) rep = repMatch[1].trim();
    }
    // Parse [N] suffix from variable name (sanitizer artifact or intentional repetition)
    const parsed = parseVarRepetition(rawName.trim());
    const varName = parsed.name;
    // Repetition from [N] suffix, unless an explicit 3rd param overrides
    const effectiveRep = rep ?? parsed.rep;

    const lines = [
      stepOpen('Set Variable', !line.disabled),
      '    <Value>',
      `      <Calculation>${cdata(value)}</Calculation>`,
      '    </Value>',
    ];
    // Only emit <Repetition> if it's not the default (1)
    if (effectiveRep && effectiveRep.trim() !== '1') {
      lines.push(
        '    <Repetition>',
        `      <Calculation>${cdata(effectiveRep)}</Calculation>`,
        '    </Repetition>',
      );
    }
    lines.push(`    <Name>${escXml(varName)}</Name>`, '  </Step>');
    return lines.join('\n');
  },
});

registerXmlToHr({
  xmlStepNames: ['Set Variable'],
  toHR(el: Element): string {
    const name = el.querySelector('Name')?.textContent ?? '';
    const value = el.querySelector('Value > Calculation')?.textContent ?? '';
    const rep = el.querySelector('Repetition > Calculation')?.textContent;
    // Only show repetition suffix for non-default values (> 1 or expressions)
    const repSuffix = rep && rep.trim() !== '1' ? `[${rep.trim()}]` : '';
    // Keep the explicit "Value:" label — must byte-match snippet_to_hr.py.
    return `Set Variable [ ${name}${repSuffix} ; Value: ${value} ]`;
  },
});

// Allow User Abort, Set Error Capture, Perform Script, and Halt Script are now
// rendered in BOTH directions by the catalog grammar engine (catalog-emit.ts /
// catalog-grammar.ts) — their former hand-coders were folded into the engine in
// P6.3. Only the control-flow set above stays hand-coded (the sanctioned
// exception): # (comment), If, Else If, Else, End If, Loop, Exit Loop If,
// End Loop, Exit Script, Set Variable.
