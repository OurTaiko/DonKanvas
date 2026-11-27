const BALLOON_COLORS = {
  '7': { fill: '#ff9c35', ink: '#98531b' },
  '9': { fill: '#ff78ae', ink: '#9e3e73' }
};

export function drawLongSpan(brush, span, x, noteY, start, end) {
  if (span.end < start || span.start > end) return;
  const left = x(Math.max(start,span.start)), right = x(Math.min(end,span.end));
  const balloon = '79'.includes(span.note), thickness = span.note === '6' ? 23 : 13;
  brush.save();
  brush.strokeStyle = balloon ? BALLOON_COLORS[span.note].fill : '#c18b12';
  brush.fillStyle = '#f7d55b';
  if (!span.complete) brush.setLineDash([6,4]);
  if (balloon) {
    brush.lineWidth = 4; brush.lineCap = 'round'; brush.beginPath(); brush.moveTo(left,noteY); brush.lineTo(right,noteY); brush.stroke();
  } else {
    const radius = thickness / 2;
    const leftRadius = span.start < start ? 0 : radius, rightRadius = span.end > end ? 0 : radius;
    const corners = leftRadius === radius && rightRadius === radius ? radius : [leftRadius,rightRadius,rightRadius,leftRadius];
    brush.lineWidth = 1.5; brush.beginPath(); brush.roundRect(left,noteY - thickness / 2,Math.max(1,right - left),thickness,corners); brush.fill(); brush.stroke();
  }
  brush.restore();
}

export function noteHitRadius(note) {
  return '346AB'.includes(note) ? 14 : '79'.includes(note) ? 16 : note === '8' ? 9 : 10;
}

export function drawNoteSelection(brush, note, pos, noteY) {
  brush.save();
  brush.strokeStyle = '#2457d6'; brush.lineWidth = 1;
  brush.setLineDash([]);
  brush.beginPath(); brush.moveTo(pos, 23); brush.lineTo(pos, noteY); brush.stroke();
  if (note === '0') {
    brush.setLineDash([3, 3]); brush.beginPath(); brush.arc(pos, noteY, 7, 0, Math.PI * 2); brush.stroke();
  } else drawNote(brush, note, pos, noteY, true);
  brush.restore();
}

export function drawNote(brush, note, pos, noteY, selected = false) {
  brush.save();
  brush.lineWidth = 2; brush.strokeStyle = selected ? '#2457d6' : '#fff';
  if ('79'.includes(note)) {
    const { fill, ink } = BALLOON_COLORS[note];
    brush.fillStyle = ink; brush.beginPath(); brush.moveTo(pos,noteY + 9); brush.lineTo(pos - 4,noteY + 15); brush.lineTo(pos + 4,noteY + 15); brush.closePath(); brush.fill();
    brush.fillStyle = fill; brush.strokeStyle = selected ? '#2457d6' : ink;
    brush.beginPath();
    if (note === '9') brush.roundRect(pos - 12,noteY - 12,24,22,7);
    else brush.ellipse(pos,noteY - 1,12,11,0,0,Math.PI * 2);
    brush.fill(); brush.stroke();
    brush.fillStyle = ink;
    for (const offset of [-4,4]) { brush.beginPath(); brush.arc(pos + offset,noteY - 3,1.5,0,Math.PI * 2); brush.fill(); }
    brush.strokeStyle = ink; brush.lineWidth = 1.5; brush.beginPath(); brush.arc(pos,noteY + 1,4,0,Math.PI); brush.stroke();
  } else if (note === '8') {
    brush.fillStyle = '#57685f'; brush.beginPath(); brush.moveTo(pos,noteY - 10); brush.lineTo(pos + 8,noteY); brush.lineTo(pos,noteY + 10); brush.lineTo(pos - 8,noteY); brush.closePath(); brush.fill(); brush.stroke();
  } else if ('56'.includes(note)) {
    const radius = note === '6' ? 13 : 9;
    brush.fillStyle = '#f4c631'; brush.strokeStyle = selected ? '#2457d6' : '#a77708'; brush.beginPath(); brush.arc(pos,noteY,radius,0,Math.PI * 2); brush.fill(); brush.stroke();
    brush.strokeStyle = '#a77708'; brush.lineWidth = 1.5;
    for (const offset of [-3,2]) { brush.beginPath(); brush.moveTo(pos + offset,noteY - 4); brush.lineTo(pos + offset,noteY + 4); brush.stroke(); }
  } else {
    brush.fillStyle = '13A'.includes(note) ? '#e65d50' : '#239eae';
    brush.beginPath(); brush.arc(pos,noteY,'34AB'.includes(note) ? 13 : 9,0,Math.PI * 2); brush.fill(); brush.stroke();
    if ('AB'.includes(note)) { brush.fillStyle = '#fff'; brush.font = 'bold 9px sans-serif'; brush.textAlign = 'center'; brush.fillText('2P',pos,noteY + 3); }
  }
  brush.restore();
}