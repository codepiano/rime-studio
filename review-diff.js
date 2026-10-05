import {createTwoFilesPatch, structuredPatch} from 'diff';

// Derive presentation data from the exact preview bytes; never reconstruct YAML.
export function withFileDiff(preview) {
  return {...preview, files:preview.files.map(file=>{
    const patch=structuredPatch(file.file,file.file,file.before,file.after,'修改前','修改后',{context:4});
    const lines=patch.hunks.flatMap(hunk=>hunk.lines);
    return {...file,
      diff:createTwoFilesPatch(file.file,file.file,file.before,file.after,'修改前','修改后',{context:4}),
      additions:lines.filter(line=>line.startsWith('+')).length,
      deletions:lines.filter(line=>line.startsWith('-')).length,
      isNew:file.before==='',
    };
  })};
}
