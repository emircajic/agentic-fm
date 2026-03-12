import type { ParsedLine } from '../parser';
import { registerHrToXml, registerXmlToHr, stepOpen, cdata } from '../step-registry';

/** Strip a "Label: " prefix (e.g. "Title: ", "Message: ", "Default Button: ") from a param value. */
function stripLabel(param: string): string {
  return param.replace(/^[A-Za-z][A-Za-z0-9 ]*:\s*/, '');
}

// --- Show Custom Dialog ---
registerHrToXml({
  stepNames: ['Show Custom Dialog'],
  toXml(line: ParsedLine): string {
    const title = line.params[0] ? stripLabel(line.params[0]) : '';
    const message = line.params[1] ? stripLabel(line.params[1]) : '';

    return [
      stepOpen('Show Custom Dialog', !line.disabled),
      '    <Title>',
      `      <Calculation>${cdata(title)}</Calculation>`,
      '    </Title>',
      '    <Message>',
      `      <Calculation>${cdata(message)}</Calculation>`,
      '    </Message>',
      '  </Step>',
    ].join('\n');
  },
});

registerXmlToHr({
  xmlStepNames: ['Show Custom Dialog'],
  toHR(el: Element): string {
    const title = el.querySelector('Title > Calculation')?.textContent ?? '';
    const message = el.querySelector('Message > Calculation')?.textContent ?? '';
    const parts: string[] = [];
    if (title) parts.push(`Title: ${title}`);
    if (message) parts.push(`Message: ${message}`);
    return `Show Custom Dialog [ ${parts.join(' ; ')} ]`;
  },
});
