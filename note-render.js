export function drawLongSpan(brush, span, x, noteY, start, end) {
  if (span.end < start || span.start > end) return;
  const left = x(Math.max(start,span.start)), right = x(Math.min(end,span.end));
  const balloon = '79'.includes(span.note), thickness = span.note === '6' ? 23 : 13;
  brush.save();
  brush.strokeStyle = balloon ? '#b54e8b' : '#c18b12';
  brush.fillStyle = balloon ? '#f5d9eb' : '#f7d55b';
  if (!span.complete) brush.setLineDash([6,4]);
  if (balloon) {
    brush.lineWidth = 3; brush.beginPath(); brush.moveTo(left,noteY + 10); brush.lineTo(right,noteY + 10); brush.stroke();
  } else {
    brush.lineWidth = 1.5; brush.beginPath(); brush.roundRect(left,noteY - thickness / 2,Math.max(1,right - left),thickness,6); brush.fill(); brush.stroke();
  }
  brush.restore();
}

export function noteHitRadius(note) {
  return '346'.includes(note) ? 14 : '79'.includes(note) ? 13 : note === '8' ? 9 : 10;
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
    brush.fillStyle = note === '9' ? '#9654b8' : '#d25e9e';
    brush.beginPath(); brush.ellipse(pos,noteY - 4,12,16,0,0,Math.PI * 2); brush.fill(); brush.stroke();
    brush.fillStyle = '#9b3970'; brush.beginPath(); brush.moveTo(pos,noteY + 11); brush.lineTo(pos - 4,noteY + 17); brush.lineTo(pos + 4,noteY + 17); brush.closePath(); brush.fill();
    brush.strokeStyle = '#9b3970'; brush.lineWidth = 1; brush.beginPath(); brush.moveTo(pos,noteY + 17); brush.bezierCurveTo(pos - 6,noteY + 21,pos + 6,noteY + 23,pos,noteY + 28); brush.stroke();
    brush.fillStyle = '#fff'; brush.font = 'bold 10px sans-serif'; brush.textAlign = 'center'; brush.fillText(note,pos,noteY);
  } else if (note === '8') {
    brush.fillStyle = '#57685f'; brush.beginPath(); brush.moveTo(pos,noteY - 10); brush.lineTo(pos + 8,noteY); brush.lineTo(pos,noteY + 10); brush.lineTo(pos - 8,noteY); brush.closePath(); brush.fill(); brush.stroke();
  } else if ('56'.includes(note)) {
    const radius = note === '6' ? 13 : 9;
    brush.fillStyle = '#f4c631'; brush.strokeStyle = selected ? '#2457d6' : '#a77708'; brush.beginPath(); brush.arc(pos,noteY,radius,0,Math.PI * 2); brush.fill(); brush.stroke();
    brush.strokeStyle = '#a77708'; brush.lineWidth = 1.5;
    for (const offset of [-3,2]) { brush.beginPath(); brush.moveTo(pos + offset,noteY - 4); brush.lineTo(pos + offset,noteY + 4); brush.stroke(); }
  } else {
    brush.fillStyle = '13'.includes(note) ? '#e65d50' : '#239eae';
    brush.beginPath(); brush.arc(pos,noteY,'34'.includes(note) ? 13 : 9,0,Math.PI * 2); brush.fill(); brush.stroke();
  }
  brush.restore();
}