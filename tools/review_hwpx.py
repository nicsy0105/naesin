"""
학생별 '틀린 문항 다시 풀기' 시험지(HWPX) 만들기

원본 클리닉 한글 파일(.hwpx)에서 학생이 틀린 문항만 그대로 가져와
학생 1명당 한글 파일 1개를 만듭니다. 원본의 글꼴·〈보기〉 상자·밑줄·미주(정답과 해설)가 그대로 유지됩니다.

  python3 tools/review_hwpx.py --source 원본.hwpx --outdir 출력폴더 \
      --title "샘플고A 1주차 복습 테스트" --label "1주차" \
      --student "홍길동:2,7,14" --student "김철수:5,6"

- 문항 번호는 1, 2, 3…으로 새로 매겨지고(한글 자동 번호), 문항 끝에 (1주차 7번)처럼 원래 번호를 붙입니다.
- '※ 다음 글을 읽고…' 지문에 딸린 문항은, 그중 하나만 틀려도 지문을 같이 넣습니다.
- 정답과 해설은 원본의 미주를 그대로 가져와 문서 맨 뒤에 나옵니다.
- 이 파일에는 학생 정보가 없습니다. 학생 이름과 틀린 번호는 실행할 때만 넣습니다.
"""
import argparse
import os
import re
import sys
import zipfile
from xml.etree import ElementTree as ET

STYLE_STEM = '3'      # 발문(자동 번호)
STYLE_PASSAGE = '10'  # '※ 다음 글을 읽고…' 줄과 미주 줄이 같은 스타일


def esc(s):
    return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('"', '&quot;')


def split_paragraphs(sec):
    """section0.xml → (앞부분, 최상위 문단 목록, 뒷부분). 미주 안의 문단은 안쪽으로 셈."""
    start = re.search(r'<hp:p[ >]', sec).start()
    end = sec.rindex('</hs:sec>')
    body = sec[start:end]
    paras, depth, cur = [], 0, None
    for m in re.finditer(r'<hp:p[ >]|</hp:p>', body):
        if m.group().startswith('</'):
            depth -= 1
            if depth == 0:
                paras.append(body[cur:m.end()])
        else:
            if depth == 0:
                cur = m.start()
            depth += 1
    if depth != 0 or ''.join(paras) != body.strip():
        raise ValueError('문단을 나누지 못했어요. 원본 구조가 예상과 달라요.')
    return sec[:start], paras, sec[end:]


def style_of(p):
    return re.match(r'<hp:p [^>]*styleIDRef="(\d+)"', p).group(1)


def top_text(p):
    p = re.sub(r'<hp:subList.*?</hp:subList>', '', p, flags=re.S)
    return ''.join(re.findall(r'<hp:t>([^<]*)</hp:t>', p))


def find_blocks(paras):
    """문항 번호 → (지문 블록 또는 None, 문항 블록)"""
    stems = [i for i, p in enumerate(paras) if style_of(p) == STYLE_STEM]
    passages = [i for i, p in enumerate(paras) if style_of(p) == STYLE_PASSAGE and top_text(p).startswith('※')]
    bounds = sorted(stems + passages) + [len(paras)]
    nxt = lambda i: bounds[bounds.index(i) + 1]
    owner = {}
    for pi in passages:
        followers = [s for s in stems if s > pi and all(not (pi < x < s) for x in passages)]
        # 지문 바로 뒤에 이어지는 '윗글' 문항들을 지문에 묶음. 하나도 없으면 바로 뒤 문항 하나에 묶음
        group = []
        for s in followers:
            if '윗글' not in top_text(paras[s]):
                break
            group.append(s)
        if not group and followers:
            group = followers[:1]
        for s in group:
            owner[s] = pi
    blocks = {}
    for n, s in enumerate(stems, 1):
        passage = None
        if s in owner:
            pi = owner[s]
            passage = (pi, paras[pi:nxt(pi)])
        blocks[n] = (passage, paras[s:nxt(s)])
    return blocks


def strip_section_controls(p):
    """첫 문단에서 쪽 설정(secPr)·다단·쪽번호를 떼어 냄"""
    p = re.sub(r'<hp:secPr.*?</hp:secPr>', '', p, flags=re.S)
    p = re.sub(r'<hp:ctrl><hp:colPr.*?</hp:colPr></hp:ctrl>', '', p, flags=re.S)
    p = re.sub(r'<hp:ctrl><hp:pageNum[^>]*/></hp:ctrl>', '', p)
    p = re.sub(r'<hp:run charPrIDRef="\d+"></hp:run>', '', p)
    return p


def add_origin_note(stem, note):
    m = list(re.finditer(r'<hp:run charPrIDRef="(\d+)"', stem))
    cp = m[-1].group(1) if m else '0'
    run = f'<hp:run charPrIDRef="{cp}"><hp:t> ({esc(note)})</hp:t></hp:run>'
    i = stem.rfind('</hp:p>')
    return stem[:i] + run + stem[i:]


def renumber_endnotes(xml):
    k = [0]
    def note(m):
        k[0] += 1
        return f'<hp:endNote number="{k[0]}"'
    xml = re.sub(r'<hp:endNote number="\d+"', note, xml)
    j = [0]
    def num(m):
        j[0] += 1
        return f'<hp:autoNum num="{j[0]}" numType="ENDNOTE"'
    xml = re.sub(r'<hp:autoNum num="\d+" numType="ENDNOTE"', num, xml)
    return xml, k[0]


def build(source, out_path, title, label, student, wrong, intro=None):
    zin = zipfile.ZipFile(source)
    files = {i.filename: zin.read(i.filename) for i in zin.infolist()}
    sec = files['Contents/section0.xml'].decode('utf-8')
    head, paras, tail = split_paragraphs(sec)
    blocks = find_blocks(paras)
    bad = [n for n in wrong if n not in blocks]
    if bad:
        raise ValueError(f'원본에 없는 문항 번호: {bad} (원본은 1~{len(blocks)}번)')

    first = paras[0]
    secpr = re.search(r'<hp:secPr.*?</hp:secPr>', first, re.S).group()
    colpr = re.search(r'<hp:ctrl><hp:colPr.*?</hp:colPr></hp:ctrl>', first, re.S)
    pagenum = re.search(r'<hp:ctrl><hp:pageNum[^>]*/></hp:ctrl>', first)
    intro = intro or f'※ {student} — {label} 클리닉에서 틀린 문항을 다시 풀어 보세요.'
    out = [
        '<hp:p id="0" paraPrIDRef="50" styleIDRef="10" pageBreak="0" columnBreak="0" merged="0">'
        f'<hp:run charPrIDRef="5">{secpr}{colpr.group() if colpr else ""}</hp:run>'
        f'<hp:run charPrIDRef="5">{pagenum.group() if pagenum else ""}<hp:t>{esc(intro)}</hp:t></hp:run></hp:p>'
    ]
    used_passages = set()
    for n in sorted(set(wrong)):
        passage, block = blocks[n]
        if passage and passage[0] not in used_passages:
            used_passages.add(passage[0])
            out.extend(passage[1])
        block = list(block)
        if block[0] is paras[0]:
            block[0] = strip_section_controls(block[0])
        block[0] = add_origin_note(block[0], f'{label} {n}번')
        out.extend(block)

    body = ''.join(out)
    body = re.sub(r'<hp:linesegarray>.*?</hp:linesegarray>', '', body, flags=re.S)  # 한글이 열 때 줄 배치를 새로 계산
    body, notes = renumber_endnotes(body)
    new_sec = head + body + tail
    ET.fromstring(new_sec.encode('utf-8'))  # XML이 깨지지 않았는지 확인

    mp = files['Contents/masterpage0.xml'].decode('utf-8')
    mp = re.sub(r'<hp:t>[^<]*</hp:t>', f'<hp:t>{esc(title)}</hp:t>', mp, count=1)
    ET.fromstring(mp.encode('utf-8'))

    prv = '\r\n'.join(t for t in (top_text(p) for p in out) if t)[:1000]
    settings = re.sub(r'paraIDRef="\d+" pos="\d+"', 'paraIDRef="0" pos="0"', files['settings.xml'].decode('utf-8'))

    files['Contents/section0.xml'] = new_sec.encode('utf-8')
    files['Contents/masterpage0.xml'] = mp.encode('utf-8')
    files['Preview/PrvText.txt'] = prv.encode('utf-8')
    files['settings.xml'] = settings.encode('utf-8')

    with zipfile.ZipFile(out_path, 'w') as zout:
        for info in zin.infolist():  # 원본과 같은 순서·압축 방식 (mimetype 맨 앞, 무압축)
            zi = zipfile.ZipInfo(info.filename, date_time=info.date_time)
            zi.compress_type = info.compress_type
            zi.external_attr = info.external_attr
            zout.writestr(zi, files[info.filename])
    return {'questions': len(set(wrong)), 'passages': len(used_passages), 'endnotes': notes}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--source', required=True)
    ap.add_argument('--outdir', required=True)
    ap.add_argument('--title', required=True)
    ap.add_argument('--label', required=True)
    ap.add_argument('--student', action='append', default=[], help='이름:틀린번호,틀린번호')
    a = ap.parse_args()
    os.makedirs(a.outdir, exist_ok=True)
    for spec in a.student:
        name, nums = spec.split(':', 1)
        wrong = [int(x) for x in re.findall(r'\d+', nums)]
        if not wrong:
            print(f'{name}: 틀린 문항 없음 → 시험지 안 만듦')
            continue
        fn = re.sub(r'[\\/:*?"<>|]', '', f'{a.title}_{name}.hwpx').replace(' ', '_')
        info = build(a.source, os.path.join(a.outdir, fn), a.title, a.label, name, wrong)
        print(f'{name}: {fn} (문항 {info["questions"]}개, 지문 {info["passages"]}개, 해설 {info["endnotes"]}개)')


if __name__ == '__main__':
    main()
