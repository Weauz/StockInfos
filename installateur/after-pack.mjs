// Après l'empaquetage Windows : met l'icône et les infos de version dans l'.exe
// (remplace rcedit, qui demanderait Wine pour construire depuis Linux)
import fs from 'fs';
import path from 'path';
import * as ResEdit from 'resedit';
import * as PELibrary from 'pe-library';

export default async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const info = context.packager.appInfo;
  const exe = path.join(context.appOutDir, `${info.productFilename}.exe`);
  const data = fs.readFileSync(exe);
  const pe = PELibrary.NtExecutable.from(data, { ignoreCert: true });
  const res = PELibrary.NtExecutableResource.from(pe);

  const ico = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(context.packager.projectDir, 'installateur', 'icon.ico')));
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  const groupId = groups.length ? groups[0].id : 1;
  const lang = groups.length ? groups[0].lang : 1033;
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, groupId, lang, ico.icons.map(i => i.data));

  const v = info.version.split('.').map(Number);
  const vi = ResEdit.Resource.VersionInfo.fromEntries(res.entries)[0] || ResEdit.Resource.VersionInfo.createEmpty();
  vi.setFileVersion(v[0], v[1], v[2], 0, 1033);
  vi.setProductVersion(v[0], v[1], v[2], 0, 1033);
  vi.setStringValues({ lang: 1033, codepage: 1200 }, {
    FileDescription: info.productName,
    ProductName: info.productName,
    CompanyName: 'StockInfos',
    LegalCopyright: `© ${new Date().getFullYear()} StockInfos`,
    OriginalFilename: `${info.productFilename}.exe`,
    InternalName: info.productFilename,
    FileVersion: info.version,
    ProductVersion: info.version
  });
  vi.outputToResourceEntries(res.entries);

  res.outputResource(pe);
  fs.writeFileSync(exe, Buffer.from(pe.generate()));
  console.log('  • icône et version écrites dans', path.basename(exe));
}
