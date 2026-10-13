#include <CoreServices/CoreServices.h>
#include <stdio.h>
#include <stdlib.h>

// Dictionary Services uses UTF-16 ranges, including for non-BMP characters.
int main(int argc, char **argv) {
  if (argc != 2) return 2;
  CFStringRef term = CFStringCreateWithCString(NULL, argv[1], kCFStringEncodingUTF8);
  if (!term) return 2;
  CFStringRef definition = DCSCopyTextDefinition(NULL, term, CFRangeMake(0, CFStringGetLength(term)));
  CFRelease(term);
  if (!definition) return 3;
  CFIndex size = CFStringGetMaximumSizeForEncoding(CFStringGetLength(definition), kCFStringEncodingUTF8) + 1;
  char *text = malloc((size_t)size);
  if (!text || !CFStringGetCString(definition, text, size, kCFStringEncodingUTF8)) {
    free(text); CFRelease(definition); return 2;
  }
  fputs(text, stdout);
  free(text); CFRelease(definition);
  return 0;
}
