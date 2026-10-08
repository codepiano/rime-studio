// Hold LevelDB's POSIX lock while the host backs up/restores a database.
// exec preserves the process identity, so rime_dict_manager can open the same lock.
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>
#include <errno.h>
int main(int argc, char **argv) {
  if (argc < 2) return 64;
  char file[8192];
  if (snprintf(file, sizeof(file), "%s/LOCK", argv[1]) >= sizeof(file)) return 64;
  int fd = open(file, O_RDWR | O_NOFOLLOW);
  struct stat st;
  if (fd < 0 || fstat(fd, &st) || !S_ISREG(st.st_mode)) { perror("LOCK"); return 66; }
  struct flock lock; memset(&lock, 0, sizeof(lock)); lock.l_type = F_WRLCK; lock.l_whence = SEEK_SET;
  if (fcntl(fd, F_SETLK, &lock)) { fprintf(stderr,"BUSY: dictionary is in use\n"); close(fd); return 75; }
  puts("LOCKED"); fflush(stdout);
  char command[16];
  if (!fgets(command, sizeof(command), stdin)) { close(fd); return 65; }
  if (argc > 2 && !strcmp(command, "RUN\n")) { execv(argv[2], argv+2); perror("exec"); close(fd); return 69; }
  close(fd); return !strcmp(command, "DONE\n") ? 0 : 65;
}
