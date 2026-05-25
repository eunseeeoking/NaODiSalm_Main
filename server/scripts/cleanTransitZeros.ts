import 'dotenv/config';
import { prisma } from '../src/services/db';

async function main() {
  const result = await prisma.transitRouteSummary.deleteMany({
    where: { transitScore: 0 },
  });
  console.log(`삭제 ${result.count}건 (transitScore=0 행 정리 완료)`);
}

main().finally(() => prisma.$disconnect());
